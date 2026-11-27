import android.content.Context;
import android.content.ContextWrapper;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;

/** Test fixture: a media session that says it is playing and opens no audio at all. Run by app_process as shell. */
public class LaneSession {
    public static void main(String[] args) throws Exception {
        Looper.prepareMainLooper();
        Class<?> msm = Class.forName("android.media.MediaServiceManager");
        java.lang.reflect.Constructor<?> c = msm.getDeclaredConstructor();
        c.setAccessible(true);
        Class.forName("android.media.MediaFrameworkPlatformInitializer").getMethod("setMediaServiceManager", msm).invoke(null, c.newInstance());
        Class<?> at = Class.forName("android.app.ActivityThread");
        Object thread = at.getMethod("systemMain").invoke(null);
        Context sys = (Context) at.getMethod("getSystemContext").invoke(thread);
        Context ctx = new ContextWrapper(sys) {
            @Override public String getPackageName() { return "com.android.shell"; }
            @Override public String getOpPackageName() { return "com.android.shell"; }
        };
        MediaSession s = new MediaSession(ctx, "lane-silent");
        s.setCallback(new MediaSession.Callback() {});
        s.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "Lane silent track")
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Output panel test").putLong(MediaMetadata.METADATA_KEY_DURATION, 600000).build());
        s.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE)
                .setState(PlaybackState.STATE_PLAYING, 1000, 1f).build());
        s.setActive(true);
        System.out.println("session active");
        new Handler(Looper.myLooper()).postDelayed(() -> { s.release(); System.exit(0); }, Long.parseLong(args[0]) * 1000);
        Looper.loop();
    }
}
