#!/usr/bin/env python3
"""
Alchemy's Chromium patches (StaticForge #993), applied to a Chromium checkout by anchor text, not line numbers, so the
same script carries over to the next Chromium version (an anchor that moved fails loudly instead of patching blind).

    python3 apply.py <chromium>/src          apply (idempotent: an edit already there is skipped)
    python3 apply.py <chromium>/src --check  only report what would change

Everything sits behind the Blink feature AlchemyEmulatedScaleCompositor (off by default; Alchemy launches Chromium with
--enable-features=AlchemyEmulatedScaleCompositor). A feature reaches renderer processes; a custom switch would not.

1. Exact pixels per tab. Under DevTools device emulation stock Chromium lays the page out at the screen's real scale
   (ScreenMetricsEmulator hands DevTools the original factor "to produce sharp image"), reports the emulated one only
   through devicePixelRatio (an inspector override), and the screencast never captures above the view's real pixel
   size. With the feature, an emulated page is laid out and composited at the emulated scale on a surface that many
   pixels large (Blink's DIP <-> Blink-pixel conversions follow, so input lands right; its own TODOs ask for exactly
   this), and the screencast captures that surface at its own size: a tab emulated at ratio 2 gives frames of CSS x 2
   pixels, sharp, with devicePixelRatio 2, whatever the screen (Xvfb) is. The emulated scale is also kept on the
   page's RenderWidgetHost, so every DevTools session follows it: Input.* positions are scaled into it (Puppeteer's
   input runs on another session than Alchemy's screencast) and the capture is sized by it. Not here: wheel
   distances (Alchemy scales those itself) and a scale change on a live page, which keeps the old scale until the
   surface is reallocated (Alchemy nudges the size by a pixel).
   Verified (scripts/test-alchemy-viewer.js --chrome): frames = the viewer's device pixels at 1, 1.25, 1.5, 2 and
   the phone's 2.625, devicePixelRatio and CSS size right, clicks, taps and wheel distances exact.

Edits are (path, anchor, replacement), or (path, ('region', start, end), old, new) to replace every `old` between two
anchors.
"""

import os
import sys

FEATURE = 'kAlchemyEmulatedScaleCompositor'

EDITS = [
    # -- the feature --
    ('third_party/blink/public/common/features.h',
     'BLINK_COMMON_EXPORT BASE_DECLARE_FEATURE(kAudioWorkletJSDenormalEnabler);\n',
     'BLINK_COMMON_EXPORT BASE_DECLARE_FEATURE(kAudioWorkletJSDenormalEnabler);\n'
     '// Alchemy (StaticForge #993): under DevTools device emulation the compositor runs at the emulated scale, so\n'
     '// the surface and the screencast have the emulated device pixels.\n'
     'BLINK_COMMON_EXPORT BASE_DECLARE_FEATURE(kAlchemyEmulatedScaleCompositor);\n'),
    ('third_party/blink/common/features.cc',
     'BASE_FEATURE(kAudioWorkletJSDenormalEnabler,\n             base::FEATURE_ENABLED_BY_DEFAULT);\n',
     'BASE_FEATURE(kAudioWorkletJSDenormalEnabler,\n             base::FEATURE_ENABLED_BY_DEFAULT);\n\n'
     'BASE_FEATURE(kAlchemyEmulatedScaleCompositor,\n             base::FEATURE_DISABLED_BY_DEFAULT);\n'),

    # -- renderer: the compositor at the emulated scale --
    ('third_party/blink/renderer/platform/widget/widget_base.cc',
     '  LayerTreeHost()->SetViewportRectAndScale(compositor_viewport_pixel_rect,\n'
     '                                           GetOriginalDeviceScaleFactor(),\n'
     '                                           local_surface_id_from_parent_);\n',
     '  float compositor_scale = GetOriginalDeviceScaleFactor();\n'
     '  gfx::Rect compositor_rect = compositor_viewport_pixel_rect;\n'
     '  // Alchemy (#993): an emulated scale is drawn at that scale, into a surface\n'
     '  // with that many pixels (the browser side scales it into the window).\n'
     '  if (base::FeatureList::IsEnabled(features::kAlchemyEmulatedScaleCompositor)) {\n'
     '    const float emulated = new_screen_info.device_scale_factor;\n'
     '    if (emulated > 0 && compositor_scale > 0 &&\n'
     '        (emulated - compositor_scale > 0.001f ||\n'
     '         compositor_scale - emulated > 0.001f)) {\n'
     '      compositor_rect = gfx::ScaleToEnclosingRect(\n'
     '          compositor_viewport_pixel_rect, emulated / compositor_scale);\n'
     '      compositor_scale = emulated;\n'
     '    }\n'
     '  }\n'
     '  LayerTreeHost()->SetViewportRectAndScale(compositor_rect, compositor_scale,\n'
     '                                           local_surface_id_from_parent_);\n'),
    # the rect handed back for re-use (UpdateScreenInfo, UpdateCompositorViewportRect) is the browser's, unscaled,
    # or the scale above would compound
    ('third_party/blink/renderer/platform/widget/widget_base.cc',
     'gfx::Rect WidgetBase::CompositorViewportRect() const {\n'
     '  return LayerTreeHost()->device_viewport_rect();\n'
     '}\n',
     'gfx::Rect WidgetBase::CompositorViewportRect() const {\n'
     '  const gfx::Rect rect = LayerTreeHost()->device_viewport_rect();\n'
     '  if (base::FeatureList::IsEnabled(features::kAlchemyEmulatedScaleCompositor)) {\n'
     '    const float original = GetOriginalDeviceScaleFactor();\n'
     '    const float current = LayerTreeHost()->device_scale_factor();\n'
     '    if (original > 0 && current > 0 &&\n'
     '        (original - current > 0.001f || current - original > 0.001f)) {\n'
     '      return gfx::ScaleToEnclosingRect(rect, original / current);\n'
     '    }\n'
     '  }\n'
     '  return rect;\n'
     '}\n'),
    # the page is laid out at the emulated scale: DevTools gets the emulated factor, not the original
    ('third_party/blink/renderer/core/frame/screen_metrics_emulator.cc',
     '#include "base/numerics/safe_conversions.h"\n',
     '#include "base/feature_list.h"\n'
     '#include "base/numerics/safe_conversions.h"\n'
     '#include "third_party/blink/public/common/features.h"\n'),
    ('third_party/blink/renderer/core/frame/screen_metrics_emulator.cc',
     '  DeviceEmulationParams modified_emulation_params = emulation_params_;\n'
     '  modified_emulation_params.device_scale_factor =\n'
     '      original_screen_info.device_scale_factor;\n',
     '  DeviceEmulationParams modified_emulation_params = emulation_params_;\n'
     '  // Alchemy (#993): laid out and drawn at the emulated scale instead\n'
     '  if (!base::FeatureList::IsEnabled(\n'
     '          features::kAlchemyEmulatedScaleCompositor) ||\n'
     '      !emulation_params_.device_scale_factor) {\n'
     '    modified_emulation_params.device_scale_factor =\n'
     '        original_screen_info.device_scale_factor;\n'
     '  }\n'),
    # DIPs <-> Blink pixels at the scale the page is laid out at (input, the widget's size)
    ('third_party/blink/renderer/platform/widget/widget_base.cc',
     'gfx::PointF WidgetBase::DIPsToBlinkSpace(const gfx::PointF& point) {\n',
     '// Alchemy (#993): the scale Blink pixels are at - the emulated one when the\n'
     '// compositor runs at it, else the original.\n'
     'static float AlchemyBlinkScale(WidgetBase& widget) {\n'
     '  const float original = widget.GetOriginalDeviceScaleFactor();\n'
     '  if (!base::FeatureList::IsEnabled(features::kAlchemyEmulatedScaleCompositor)) {\n'
     '    return original;\n'
     '  }\n'
     '  const float current = widget.GetScreenInfo().device_scale_factor;\n'
     '  return current > 0 ? current : original;\n'
     '}\n\n'
     'gfx::PointF WidgetBase::DIPsToBlinkSpace(const gfx::PointF& point) {\n'),
    ('third_party/blink/renderer/platform/widget/widget_base.cc',
     ('region', 'gfx::PointF WidgetBase::DIPsToBlinkSpace(const gfx::PointF& point) {\n',
      'gfx::RectF WidgetBase::BlinkSpaceToDIPs(const gfx::RectF& rect) {\n  float reverse = 1 / GetOriginalDeviceScaleFactor();\n'),
     'GetOriginalDeviceScaleFactor()', 'AlchemyBlinkScale(*this)'),

    # 2. over-render: the main document's content is not clipped at the viewport's bottom (painting only; the
    #    hit-test clip stays). With a view taller than the emulated page (Emulation.setDeviceMetricsOverride
    #    dontSetVisibleSize + Emulation.setVisibleSize) the band below the viewport shows the page's real content
    #    while the page keeps its viewport (no resize, fixed footers stay at the viewport's bottom). Without one, the
    #    extra content lies outside the surface and is never drawn.
    ('third_party/blink/renderer/core/paint/paint_property_tree_builder.cc',
     '#include "base/feature_list.h"\n',
     '#include "base/feature_list.h"\n'
     '#include "third_party/blink/public/common/features.h"\n'),
    ('third_party/blink/renderer/core/paint/paint_property_tree_builder.cc',
     '        PhysicalRect clip_rect =\n'
     '            box_fragment.OverflowClipRect(FindPreviousBreakToken(box_fragment));\n'
     '        clip_rect.Move(context_.current.paint_offset);\n',
     '        PhysicalRect clip_rect =\n'
     '            box_fragment.OverflowClipRect(FindPreviousBreakToken(box_fragment));\n'
     '        clip_rect.Move(context_.current.paint_offset);\n'
     '        // Alchemy (#993): the outermost document draws on below its viewport\n'
     '        if (object_.IsLayoutView() &&\n'
     '            object_.GetFrame()->IsOutermostMainFrame() &&\n'
     '            base::FeatureList::IsEnabled(\n'
     '                features::kAlchemyEmulatedScaleCompositor)) {\n'
     '          clip_rect.size.height += LayoutUnit(8192);\n'
     '        }\n'),

    # -- browser: the emulated scale lives on the page's widget, for every DevTools session --
    # (Puppeteer's input and Alchemy's screencast run on different sessions, each with its own EmulationHandler)
    ('content/browser/renderer_host/render_widget_host_impl.h',
     '  float GetDeviceScaleFactor() override;\n',
     '  float GetDeviceScaleFactor() override;\n'
     '  // Alchemy (#993): the scale a DevTools session emulates on this widget\n'
     '  // (0: none), read by the DevTools input and screencast code.\n'
     '  float alchemy_emulated_scale() const { return alchemy_emulated_scale_; }\n'
     '  void set_alchemy_emulated_scale(float scale) {\n'
     '    alchemy_emulated_scale_ = scale;\n'
     '  }\n'
     '  float alchemy_emulated_scale_ = 0;\n'),
    ('content/browser/devtools/protocol/emulation_handler.cc',
     '#include "content/browser/devtools/protocol/emulation_handler.h"\n',
     '#include "content/browser/devtools/protocol/emulation_handler.h"\n\n'
     '#include "base/feature_list.h"\n'
     '#include "third_party/blink/public/common/features.h"\n'),
    ('content/browser/devtools/protocol/emulation_handler.cc',
     '  auto& frame_widget = render_widget_host->GetAssociatedFrameWidget();\n'
     '  if (!frame_widget)\n'
     '    return;\n'
     '  if (device_emulation_enabled_) {\n',
     '  auto& frame_widget = render_widget_host->GetAssociatedFrameWidget();\n'
     '  if (!frame_widget)\n'
     '    return;\n'
     '  if (base::FeatureList::IsEnabled(\n'
     '          blink::features::kAlchemyEmulatedScaleCompositor)) {\n'
     '    render_widget_host->set_alchemy_emulated_scale(\n'
     '        device_emulation_enabled_ ? device_emulation_params_.device_scale_factor\n'
     '                                  : 0);\n'
     '  }\n'
     '  if (device_emulation_enabled_) {\n'),
    # input from DevTools lands in the emulated pixel space (main and compositor thread alike)
    ('content/browser/devtools/protocol/input_handler.cc',
     '#include "content/browser/devtools/protocol/input_handler.h"\n',
     '#include "content/browser/devtools/protocol/input_handler.h"\n\n'
     '#include "base/feature_list.h"\n'
     '#include "third_party/blink/public/common/features.h"\n'),
    ('content/browser/devtools/protocol/input_handler.cc',
     '  scale_factor *= web_contents_->GetPrimaryPage().GetPageScaleFactor();\n'
     '\n'
     '  return scale_factor;\n'
     '}\n',
     '  scale_factor *= web_contents_->GetPrimaryPage().GetPageScaleFactor();\n'
     '  // Alchemy (#993): the page is laid out at the emulated scale, not the real one\n'
     '  if (base::FeatureList::IsEnabled(\n'
     '          blink::features::kAlchemyEmulatedScaleCompositor) &&\n'
     '      widget_host_for_zoom_level) {\n'
     '    const float emulated = widget_host_for_zoom_level->alchemy_emulated_scale();\n'
     '    const float real = widget_host_for_zoom_level->GetDeviceScaleFactor();\n'
     '    if (emulated > 0 && real > 0) {\n'
     '      scale_factor *= emulated / real;\n'
     '    }\n'
     '  }\n'
     '\n'
     '  return scale_factor;\n'
     '}\n'),

    # -- browser: the screencast captures the surface at its own size --
    ('content/browser/devtools/protocol/page_handler.cc',
     '#include "content/browser/devtools/protocol/page_handler.h"\n',
     '#include "content/browser/devtools/protocol/page_handler.h"\n\n'
     '#include "third_party/blink/public/common/features.h"\n'),
    ('content/browser/devtools/protocol/page_handler.cc',
     'void GetMetadataFromFrame(const media::VideoFrame& frame,\n',
     '// Alchemy (#993): with the compositor at the emulated scale, the page\'s surface\n'
     '// is the view\'s pixel size times emulated / real scale.\n'
     'gfx::Size AlchemySurfaceSize(RenderWidgetHostViewBase* view,\n'
     '                             RenderWidgetHostImpl* widget) {\n'
     '  gfx::Size size = view->GetCompositorViewportPixelSize();\n'
     '  if (!widget || !base::FeatureList::IsEnabled(\n'
     '                     blink::features::kAlchemyEmulatedScaleCompositor)) {\n'
     '    return size;\n'
     '  }\n'
     '  const float emulated = widget->alchemy_emulated_scale();\n'
     '  const float real = view->GetDeviceScaleFactor();\n'
     '  if (emulated <= 0 || real <= 0) {\n'
     '    return size;\n'
     '  }\n'
     '  return gfx::ScaleToCeiledSize(size, emulated / real);\n'
     '}\n\n'
     'void GetMetadataFromFrame(const media::VideoFrame& frame,\n'),
    ('content/browser/devtools/protocol/page_handler.cc',
     '    surface_size = view->GetCompositorViewportPixelSize();\n'
     '    last_surface_size_ = surface_size;\n',
     '    surface_size = AlchemySurfaceSize(view, host_->GetRenderWidgetHost());\n'
     '    last_surface_size_ = surface_size;\n'),
    ('content/browser/devtools/protocol/page_handler.cc',
     '  const gfx::Size surface_size = view->GetCompositorViewportPixelSize();\n'
     '  if (surface_size.IsEmpty()) {\n',
     '  const gfx::Size surface_size =\n'
     '      AlchemySurfaceSize(view, host_ ? host_->GetRenderWidgetHost() : nullptr);\n'
     '  if (surface_size.IsEmpty()) {\n'),
]


def region_edit(src, check, rel, region, old, new):
    """Replace every `old` with `new` from the start anchor through the end anchor (both included)."""
    _, start, end = region
    path = os.path.join(src, rel)
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    a = text.find(start)
    end_probe = end.replace(old, new)
    b = text.find(end, a) if a >= 0 else -1
    if b < 0 and a >= 0:
        b = text.find(end_probe, a)
        if b >= 0 and old not in text[a:b + len(end_probe)]:
            print('already  ' + rel + ' (region)')
            return 0
    if a < 0 or b < 0:
        print('ANCHOR   ' + rel + ' (region): ' + start.strip())
        return 1
    b += len(end)
    count = text[a:b].count(old)
    print(('would    ' if check else 'patched  ') + rel + ' (region, ' + str(count) + ' replacements)')
    if not check:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(text[:a] + text[a:b].replace(old, new) + text[b:])
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = sys.argv[1]
    check = '--check' in sys.argv
    failed = 0
    for edit in EDITS:
        if len(edit) == 4:
            failed += region_edit(src, check, *edit)
            continue
        rel, anchor, replacement = edit
        path = os.path.join(src, rel)
        with open(path, encoding='utf-8') as fh:
            text = fh.read()
        if replacement in text:
            print('already  ' + rel)
            continue
        count = text.count(anchor)
        if count != 1:
            print('ANCHOR   ' + rel + ' (found ' + str(count) + 'x): ' + anchor.splitlines()[0].strip())
            failed += 1
            continue
        print(('would    ' if check else 'patched  ') + rel)
        if not check:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(text.replace(anchor, replacement))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
