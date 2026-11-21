// jxl-pipe: JPEG XL for Alchemy, persistent. argv[1]: effort (default 3). Two requests on stdin:
//   [u32 LE length][JPEG]                     lossless JPEG -> JPEG XL repack (the pixels stay the JPEG's)
//   [u32 LE length | 0x80000000][u32 w][u32 h][u8 channels 3|4][u8 lossless][u16 distance x 100][pixels]
//                                             8-bit RGB / RGBA pixels -> JPEG XL at that distance (or lossless),
//                                             with alpha when channels is 4 (Yukimi, Nov 21: "JPEG XL by default as
//                                             layers can use transparentcy and would be always better quality")
// stdout: [u32 LE length][JXL] (length 0: could not encode). The JPEG reconstruction data is not kept: the viewer
// shows pixels, it never needs the original file back.
#include <jxl/encode.h>
#include <jxl/thread_parallel_runner.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int read_full(void *buf, size_t n) {
  size_t got = 0;
  while (got < n) { size_t r = fread((char *)buf + got, 1, n - got, stdin); if (!r) return 0; got += r; }
  return 1;
}
static uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
int main(int argc, char **argv) {
  int effort = argc > 1 ? atoi(argv[1]) : 3;
  // argv[2]: worker threads (default: half the cores, at least 1): the encode is split across them
  int threads = argc > 2 ? atoi(argv[2]) : (int)(JxlThreadParallelRunnerDefaultNumWorkerThreads() / 2);
  if (threads < 1) threads = 1;
  JxlEncoder *enc = JxlEncoderCreate(NULL);
  void *runner = JxlThreadParallelRunnerCreate(NULL, threads);
  uint8_t *in = NULL; size_t cap = 0;
  size_t ocap = 1 << 20; uint8_t *out = malloc(ocap);
  for (;;) {
    uint32_t len;
    if (!read_full(&len, 4)) break;
    int raw = (len & 0x80000000u) != 0;
    len &= 0x7fffffffu;
    if (len > cap) { in = realloc(in, len); cap = len; }
    if (len && !read_full(in, len)) break;
    JxlEncoderReset(enc);
    if (runner) JxlEncoderSetParallelRunner(enc, JxlThreadParallelRunner, runner);
    JxlEncoderFrameSettings *fs = JxlEncoderFrameSettingsCreate(enc, NULL);
    JxlEncoderFrameSettingsSetOption(fs, JXL_ENC_FRAME_SETTING_EFFORT, effort);
    int ok = 0;
    if (!raw) {
      JxlEncoderStoreJPEGMetadata(enc, JXL_FALSE);
      ok = len && JxlEncoderAddJPEGFrame(fs, in, len) == JXL_ENC_SUCCESS;
    } else if (len >= 12) {
      uint32_t w = rd32(in), h = rd32(in + 4);
      uint32_t ch = in[8], lossless = in[9];
      uint32_t dist100 = (uint32_t)in[10] | ((uint32_t)in[11] << 8);
      size_t need = (size_t)w * h * ch;
      if ((ch == 3 || ch == 4) && w && h && len - 12 >= need) {
        JxlBasicInfo info;
        JxlEncoderInitBasicInfo(&info);
        info.xsize = w; info.ysize = h;
        info.bits_per_sample = 8;
        info.num_color_channels = 3;
        info.alpha_bits = ch == 4 ? 8 : 0;
        info.num_extra_channels = ch == 4 ? 1 : 0;
        info.uses_original_profile = lossless ? JXL_TRUE : JXL_FALSE;
        if (JxlEncoderSetBasicInfo(enc, &info) == JXL_ENC_SUCCESS) {
          JxlColorEncoding color;
          JxlColorEncodingSetToSRGB(&color, JXL_FALSE);
          JxlEncoderSetColorEncoding(enc, &color);
          if (lossless) JxlEncoderSetFrameLossless(fs, JXL_TRUE);
          else JxlEncoderSetFrameDistance(fs, dist100 / 100.0f);
          JxlPixelFormat fmt = { ch, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0 };
          ok = JxlEncoderAddImageFrame(fs, &fmt, in + 12, need) == JXL_ENC_SUCCESS;
        }
      }
    }
    uint32_t outlen = 0;
    if (ok) {
      JxlEncoderCloseInput(enc);
      uint8_t *next = out; size_t avail = ocap; JxlEncoderStatus st;
      while ((st = JxlEncoderProcessOutput(enc, &next, &avail)) == JXL_ENC_NEED_MORE_OUTPUT) {
        size_t used = next - out; ocap *= 2; out = realloc(out, ocap); next = out + used; avail = ocap - used;
      }
      if (st == JXL_ENC_SUCCESS) outlen = (uint32_t)(next - out);
    }
    fwrite(&outlen, 4, 1, stdout);
    if (outlen) fwrite(out, 1, outlen, stdout);
    fflush(stdout);
  }
  JxlEncoderDestroy(enc);
  if (runner) JxlThreadParallelRunnerDestroy(runner);
  return 0;
}
