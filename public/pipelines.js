// Pipeline Editor Logic
let pipelineEditorModal, openPipelineEditorBtn, closePipelineEditorBtn, pipelineEditorForm;
let pipelineNameInput, pipelineResolutionSelect, pipelineCustomResolutionGroup, pipelineCustomWidth, pipelineCustomHeight;
let pipelineLayersContainer, addPipelineLayerBtn, savePipelineBtn, cancelPipelineBtn;
let pipelinePresets = [];

function getAllPresets() {
  // Use global presets if available
  if (window.presets) return window.presets;
  // Fallback: try to fetch from backend (stub)
  return [];
}

function showPipelineEditor(pipeline = null) {
  pipelineEditorModal.style.display = 'flex';
  document.body.classList.add('modal-open');
  // Reset form
  pipelineEditorForm.reset();
  pipelineLayersContainer.innerHTML = '';
  pipelinePresets = getAllPresets();

  if (pipeline) {
    pipelineNameInput.value = pipeline.name || '';
    pipelineResolutionSelect.value = pipeline.resolution || 'normal_portrait';
    if (pipeline.resolution === 'custom') {
      pipelineCustomResolutionGroup.style.display = '';
      pipelineCustomWidth.value = pipeline.width || 1024;
      pipelineCustomHeight.value = pipeline.height || 1024;
    } else {
      pipelineCustomResolutionGroup.style.display = 'none';
    }
    // Load layers
    if (Array.isArray(pipeline.layers)) {
      for (const layer of pipeline.layers) {
        addPipelineLayer(layer);
      }
    }
  } else {
    pipelineNameInput.value = '';
    pipelineResolutionSelect.value = 'normal_portrait';
    pipelineCustomResolutionGroup.style.display = 'none';
    pipelineCustomWidth.value = 1024;
    pipelineCustomHeight.value = 1024;
    addPipelineLayer();
  }
}

function closePipelineEditor() {
  pipelineEditorModal.style.display = 'none';
  document.body.classList.remove('modal-open');
}

function addPipelineLayer(layer = null) {
    const idx = pipelineLayersContainer.children.length;
    const layerDiv = document.createElement('div');
    layerDiv.className = 'pipeline-layer-editor';
    layerDiv.style.border = '1px solid #444';
    layerDiv.style.padding = '10px';
    layerDiv.style.marginBottom = '10px';
    layerDiv.style.background = '#181c22';
  
    // Preset select label
    const presetLabel = document.createElement('label');
    presetLabel.textContent = 'Preset:';
    presetLabel.style.marginRight = '8px';
    layerDiv.appendChild(presetLabel);
  
    // Preset select dropdown
    const presetSelect = document.createElement('select');
    presetSelect.className = 'form-control hover-show colored';
    for (const preset of pipelinePresets) {
      const opt = document.createElement('option');
      opt.value = preset.name;
      opt.textContent = preset.name;
      presetSelect.appendChild(opt);
    }
    presetSelect.value = layer && layer.preset ? layer.preset : (pipelinePresets[0]?.name || '');
    layerDiv.appendChild(presetSelect);
  
    // Mask button
    const maskBtn = document.createElement('button');
    maskBtn.type = 'button';
    maskBtn.className = 'btn-secondary';
    maskBtn.textContent = 'Edit Mask';
    maskBtn.style.marginLeft = '8px';
    let maskBase64 = layer && layer.mask ? layer.mask : null;
    maskBtn._maskBase64 = maskBase64;
    maskBtn.addEventListener('click', () => {
      // Get the current resolution for this pipeline
      let res = pipelineResolutionSelect.value;
      let width = 1024, height = 1536;
      if (res === 'custom') {
        width = parseInt(pipelineCustomWidth.value) || 1024;
        height = parseInt(pipelineCustomHeight.value) || 1536;
      } else {
        // Use the same mapping as backend
        const resMap = {
          'normal_portrait': [832, 1216],
          'normal_landscape': [1216, 832],
          'normal_square': [1024, 1024],
          'large_portrait': [1024, 1536],
          'large_landscape': [1536, 1024],
          'large_square': [1472, 1472],
          'wallpaper_portrait': [1088, 1920],
          'wallpaper_landscape': [1920, 1088]
        };
        if (resMap[res]) {
          width = resMap[res][0];
          height = resMap[res][1];
        }
      }
      // Generate a blank gray image for the mask background
      const gray = 180;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const ctx = tempCanvas.getContext('2d');
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(0, 0, width, height);
      const blankGrayDataUrl = tempCanvas.toDataURL('image/png');
      // Pass a flag to the mask editor to indicate pipeline mask editing
      openMaskEditorForLayer(maskBase64, (newMask) => {
        maskBase64 = newMask;
        maskBtn._maskBase64 = newMask;
      }, {
        backgroundImage: blankGrayDataUrl,
        width,
        height,
        isPipelineMask: true
      });
    });
    layerDiv.appendChild(maskBtn);
  
    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.style.marginLeft = '8px';
    removeBtn.addEventListener('click', () => {
      pipelineLayersContainer.removeChild(layerDiv);
    });
    layerDiv.appendChild(removeBtn);
  
    pipelineLayersContainer.appendChild(layerDiv);
}

function openMaskEditorForLayer(existingMask, onSave, opts = {}) {
    // Use the global mask editor modal, set up for this layer
    // Save/restore mask data
    if (window.setMaskEditorFromDataUrl && typeof window.setMaskEditorFromDataUrl === 'function') {
        if (existingMask) {
        window.setMaskEditorFromDataUrl('data:image/png;base64,' + existingMask);
        } else if (opts.backgroundImage) {
        window.setMaskEditorFromDataUrl(opts.backgroundImage);
        } else {
        window.setMaskEditorFromDataUrl(null);
        }
    }
    // Set a global flag for pipeline mask editing
    window.isPipelineMaskEdit = !!opts.isPipelineMask;
    window.pipelineMaskEditWidth = opts.width;
    window.pipelineMaskEditHeight = opts.height;
    // Show the mask editor modal
    const maskEditorDialog = document.getElementById('maskEditorDialog');
    if (maskEditorDialog) maskEditorDialog.style.display = 'flex';
    // When the user clicks save in the mask editor, capture the mask
    const saveBtn = document.getElementById('saveMaskBtn');
    if (saveBtn) {
        const handler = () => {
        if (window.currentMaskData) {
            // Remove data:image/png;base64,
            const base64 = window.currentMaskData.replace(/^data:image\/png;base64,/, '');
            onSave(base64);
        }
        saveBtn.removeEventListener('click', handler);
        };
        saveBtn.addEventListener('click', handler);
    }
}

function openMaskEditorForLayer(existingMask, onSave) {
  // Use the global mask editor modal, set up for this layer
  // Save/restore mask data
  if (window.setMaskEditorFromDataUrl && typeof window.setMaskEditorFromDataUrl === 'function') {
    if (existingMask) {
      window.setMaskEditorFromDataUrl('data:image/png;base64,' + existingMask);
    } else {
      window.setMaskEditorFromDataUrl(null);
    }
  }
  // Show the mask editor modal
  const maskEditorDialog = document.getElementById('maskEditorDialog');
  if (maskEditorDialog) maskEditorDialog.style.display = 'flex';
  // When the user clicks save in the mask editor, capture the mask
  const saveBtn = document.getElementById('saveMaskBtn');
  if (saveBtn) {
    const handler = () => {
      if (window.currentMaskData) {
        // Remove data:image/png;base64,
        const base64 = window.currentMaskData.replace(/^data:image\/png;base64,/, '');
        onSave(base64);
      }
      saveBtn.removeEventListener('click', handler);
    };
    saveBtn.addEventListener('click', handler);
  }
}

function collectPipelineConfigFromForm() {
  const name = pipelineNameInput.value.trim();
  let resolution = pipelineResolutionSelect.value;
  let width = null, height = null;
  if (resolution === 'custom') {
    width = parseInt(pipelineCustomWidth.value) || 1024;
    height = parseInt(pipelineCustomHeight.value) || 1024;
  }
  const layers = [];
  for (const layerDiv of pipelineLayersContainer.children) {
    const preset = layerDiv.querySelector('select').value;
    // Find the mask (closure variable)
    let mask = null;
    for (const btn of layerDiv.querySelectorAll('button')) {
      if (btn.textContent === 'Edit Mask' && btn._maskBase64) {
        mask = btn._maskBase64;
      }
    }
    layers.push({ preset, mask });
  }
  const config = { name, resolution, layers };
  if (resolution === 'custom') {
    config.width = width;
    config.height = height;
  }
  return config;
}

async function savePipeline() {
  const config = collectPipelineConfigFromForm();
  // POST to backend (stub)
  await fetch('/pipeline/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  closePipelineEditor();
  // Optionally refresh preset/pipeline dropdown
  if (typeof renderCustomPresetDropdown === 'function') renderCustomPresetDropdown();
}

document.addEventListener('DOMContentLoaded', function() {
  pipelineEditorModal = document.getElementById('pipelineEditorModal');
  openPipelineEditorBtn = document.getElementById('openPipelineEditorBtn');
  closePipelineEditorBtn = document.getElementById('closePipelineEditorBtn');
  pipelineEditorForm = document.getElementById('pipelineEditorForm');
  pipelineNameInput = document.getElementById('pipelineNameInput');
  pipelineResolutionSelect = document.getElementById('pipelineResolutionSelect');
  pipelineCustomResolutionGroup = document.getElementById('pipelineCustomResolutionGroup');
  pipelineCustomWidth = document.getElementById('pipelineCustomWidth');
  pipelineCustomHeight = document.getElementById('pipelineCustomHeight');
  pipelineLayersContainer = document.getElementById('pipelineLayersContainer');
  addPipelineLayerBtn = document.getElementById('addPipelineLayerBtn');
  savePipelineBtn = document.getElementById('savePipelineBtn');
  cancelPipelineBtn = document.getElementById('cancelPipelineBtn');

  if (openPipelineEditorBtn) openPipelineEditorBtn.addEventListener('click', () => showPipelineEditor());
  if (closePipelineEditorBtn) closePipelineEditorBtn.addEventListener('click', closePipelineEditor);
  if (cancelPipelineBtn) cancelPipelineBtn.addEventListener('click', closePipelineEditor);
  if (addPipelineLayerBtn) addPipelineLayerBtn.addEventListener('click', () => addPipelineLayer());
  if (savePipelineBtn) savePipelineBtn.addEventListener('click', savePipeline);
  pipelineResolutionSelect.addEventListener('change', function() {
    if (pipelineResolutionSelect.value === 'custom') {
      pipelineCustomResolutionGroup.style.display = '';
    } else {
      pipelineCustomResolutionGroup.style.display = 'none';
    }
  });
});