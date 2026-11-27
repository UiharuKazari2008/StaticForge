# A virtual Bluetooth A2DP sink on the emulator's netsim radio (Google Bumble). It receives and drops audio; nothing is played anywhere.
import asyncio, logging, sys
from bumble.device import Device
from bumble.core import PhysicalTransport
from bumble.hci import Address
from bumble.transport import open_transport
from bumble.pairing import PairingConfig, PairingDelegate
from bumble.keys import MemoryKeyStore
from bumble import avdtp, a2dp

def log(*a): print(*a, flush=True)

def codec_capabilities():
    return avdtp.MediaCodecCapabilities(
        media_type=avdtp.AVDTP_AUDIO_MEDIA_TYPE,
        media_codec_type=a2dp.A2DP_SBC_CODEC_TYPE,
        media_codec_information=a2dp.SbcMediaCodecInformation(
            sampling_frequency=a2dp.SbcMediaCodecInformation.SamplingFrequency.SF_48000 | a2dp.SbcMediaCodecInformation.SamplingFrequency.SF_44100,
            channel_mode=a2dp.SbcMediaCodecInformation.ChannelMode.JOINT_STEREO | a2dp.SbcMediaCodecInformation.ChannelMode.STEREO,
            block_length=a2dp.SbcMediaCodecInformation.BlockLength.BL_16 | a2dp.SbcMediaCodecInformation.BlockLength.BL_12 | a2dp.SbcMediaCodecInformation.BlockLength.BL_8 | a2dp.SbcMediaCodecInformation.BlockLength.BL_4,
            subbands=a2dp.SbcMediaCodecInformation.Subbands.S_8 | a2dp.SbcMediaCodecInformation.Subbands.S_4,
            allocation_method=a2dp.SbcMediaCodecInformation.AllocationMethod.LOUDNESS | a2dp.SbcMediaCodecInformation.AllocationMethod.SNR,
            minimum_bitpool_value=2, maximum_bitpool_value=53))

def on_avdtp(protocol):
    log('AVDTP connection')
    sink = protocol.add_sink(codec_capabilities())
    sink.on('rtp_packet', lambda p: None)

async def main():
    async with await open_transport(sys.argv[1]) as t:
        d = Device.with_hci('Lane Test Speaker', Address('F0:F1:F2:F3:F4:F5'), t.source, t.sink)
        d.classic_enabled = True
        d.class_of_device = 0x240414
        d.keystore = MemoryKeyStore()
        d.pairing_config_factory = lambda c: PairingConfig(sc=True, mitm=False, bonding=True,
            delegate=PairingDelegate(PairingDelegate.IoCapability.NO_OUTPUT_NO_INPUT))
        d.sdp_service_records = {0x00010001: a2dp.make_audio_sink_service_sdp_records(0x00010001)}
        listener = avdtp.Listener.for_device(device=d, version=(1, 2))
        listener.on('connection', on_avdtp)
        d.on('connection', lambda c: log('BT connection from', c.peer_address))
        await d.power_on()
        await d.set_discoverable(True)
        await d.set_connectable(True)
        log('ready: discoverable as', d.name, d.public_address)
        await asyncio.sleep(float(sys.argv[2]))
        await d.power_off()
        log('powered off')

logging.basicConfig(level=logging.WARNING)
asyncio.run(main())
