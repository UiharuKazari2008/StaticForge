// jxl-pipe: lossless JPEG -> JPEG XL repacking, persistent. stdin: [u32 LE length][JPEG], stdout: [u32 LE length][JXL]
// (length 0: could not repack). argv[1]: effort (default 3). The JPEG reconstruction data is not kept: the viewer
// shows pixels, it never needs the original file back.
#include <jxl/encode.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
static int read_full(void *buf, size_t n) {
  size_t got = 0;
  while (got < n) { size_t r = fread((char *)buf + got, 1, n - got, stdin); if (!r) return 0; got += r; }
  return 1;
}
int main(int argc, char **argv) {
  int effort = argc > 1 ? atoi(argv[1]) : 3;
  JxlEncoder *enc = JxlEncoderCreate(NULL);
  uint8_t *in = NULL; size_t cap = 0;
  size_t ocap = 1 << 20; uint8_t *out = malloc(ocap);
  for (;;) {
    uint32_t len;
    if (!read_full(&len, 4)) break;
    if (len > cap) { in = realloc(in, len); cap = len; }
    if (len && !read_full(in, len)) break;
    JxlEncoderReset(enc);
    JxlEncoderStoreJPEGMetadata(enc, JXL_FALSE);
    JxlEncoderFrameSettings *fs = JxlEncoderFrameSettingsCreate(enc, NULL);
    JxlEncoderFrameSettingsSetOption(fs, JXL_ENC_FRAME_SETTING_EFFORT, effort);
    uint32_t outlen = 0;
    if (len && JxlEncoderAddJPEGFrame(fs, in, len) == JXL_ENC_SUCCESS) {
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
  return 0;
}
