// Vista VM helper agent (Yukimi authorized in chat 2026-10-12: throwaway reference VM).
// Listens on TCP 8790 inside the VM; only requests with header X-Token are served.
//   GET  /ping | POST /run?t=60 (body=cmd) | GET /get?path= | POST /put?path= (auto-rename)
//   GET  /list?path= | GET /exists?path=
//   GET  /shot?x=&y=&w=&h=&delay=ms | GET /icon?file=&index=&size= | GET /iconcount?file=
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

class Agent
{
    // Per-VM token: C:\agent\token.txt (written by rackd linked-clone through the guest agent); read per request so a new token needs no restart.
    static string TOKEN { get { try { return File.ReadAllText(@"C:\agent\token.txt").Trim(); } catch { return "\u0001no-token"; } } }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "PrivateExtractIconsW")]
    static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, int[] ids, uint n, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "ExtractIconExW")]
    static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint n);

    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr h);

    static int PORT = 8790;
    [STAThread]
    static void Main(string[] a)
    {
        if (a.Length > 0) PORT = int.Parse(a[0]);
        bool created;
        Mutex mx = new Mutex(true, "Global\\RackVmAgent" + PORT, out created);
        if (!created) return; // single instance
        AppDomain.CurrentDomain.UnhandledException += delegate(object sd, UnhandledExceptionEventArgs ev)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "agent-crash.log"), DateTime.Now + " " + ev.ExceptionObject + "\r\n"); } catch { }
        };
        TcpListener l = null;
        while (l == null)
        {
            try { l = new TcpListener(IPAddress.Any, PORT); l.Start(); }
            catch (SocketException) { l = null; Thread.Sleep(5000); } // port busy: retry
        }
        Console.WriteLine("agent listening on " + PORT);
        while (true)
        {
            try
            {
                TcpClient c = l.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(new WaitCallback(Handle), c);
            }
            catch (Exception) { Thread.Sleep(500); }
        }
        GC.KeepAlive(mx);
    }

    static void Handle(object o)
    {
        TcpClient c = (TcpClient)o;
        try
        {
            NetworkStream s = c.GetStream();
            s.ReadTimeout = 60000;
            StringBuilder hb = new StringBuilder();
            int ch;
            while ((ch = s.ReadByte()) != -1)
            {
                hb.Append((char)ch);
                if (hb.Length >= 4 && hb.ToString(hb.Length - 4, 4) == "\r\n\r\n") break;
                if (hb.Length > 65536) break;
            }
            string[] lines = hb.ToString().Split(new string[] { "\r\n" }, StringSplitOptions.None);
            string[] rl = lines[0].Split(' ');
            string target = rl.Length > 1 ? rl[1] : "/";
            Dictionary<string, string> h = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < lines.Length; i++)
            {
                int k = lines[i].IndexOf(':');
                if (k > 0) h[lines[i].Substring(0, k).Trim()] = lines[i].Substring(k + 1).Trim();
            }
            byte[] body = new byte[0];
            string cl;
            if (h.TryGetValue("Content-Length", out cl))
            {
                int n = int.Parse(cl);
                body = new byte[n];
                int off = 0;
                while (off < n)
                {
                    int r = s.Read(body, off, n - off);
                    if (r <= 0) break;
                    off += r;
                }
            }
            string tok;
            if (!h.TryGetValue("X-Token", out tok) || tok != TOKEN)
            {
                Send(s, 403, Encoding.UTF8.GetBytes("forbidden"), "text/plain");
                return;
            }
            string path = target, query = "";
            int q = target.IndexOf('?');
            if (q >= 0) { path = target.Substring(0, q); query = target.Substring(q + 1); }
            Dictionary<string, string> qs = ParseQuery(query);
            string ct = "text/plain; charset=utf-8";
            byte[] outb;
            if (path == "/ping")
            {
                Rectangle sc = Screen.PrimaryScreen.Bounds;
                outb = Encoding.UTF8.GetBytes("pong " + Environment.MachineName + " " + sc.Width + "x" + sc.Height);
            }
            else if (path == "/run") outb = Encoding.UTF8.GetBytes(Run(Encoding.UTF8.GetString(body), GetInt(qs, "t", 60)));
            else if (path == "/get") { outb = File.ReadAllBytes(qs["path"]); ct = "application/octet-stream"; }
            else if (path == "/put") { string pp = UniquePath(qs["path"]); File.WriteAllBytes(pp, body); outb = Encoding.UTF8.GetBytes("ok " + body.Length + " " + pp); }
            else if (path == "/list") { outb = ListPath(qs.ContainsKey("path") ? qs["path"] : ""); ct = "text/plain; charset=utf-8"; }
            else if (path == "/exists") { string ep = qs["path"]; bool ex = File.Exists(ep) || Directory.Exists(ep); outb = Encoding.UTF8.GetBytes(ex ? "1" : "0"); }
            else if (path == "/shot") { outb = Shot(qs); ct = "image/png"; }
            else if (path == "/icon") { outb = IconPng(qs["file"], GetInt(qs, "index", 0), GetInt(qs, "size", 32)); ct = "image/png"; }
            else if (path == "/iconcount") outb = Encoding.UTF8.GetBytes(ExtractIconEx(qs["file"], -1, null, null, 0).ToString());
            else { Send(s, 404, Encoding.UTF8.GetBytes("not found"), ct); return; }
            Send(s, 200, outb, ct);
        }
        catch (Exception e)
        {
            try { Send(c.GetStream(), 500, Encoding.UTF8.GetBytes(e.ToString()), "text/plain"); } catch { }
        }
        finally { c.Close(); }
    }

    static Dictionary<string, string> ParseQuery(string q)
    {
        Dictionary<string, string> d = new Dictionary<string, string>();
        foreach (string p in q.Split('&'))
        {
            if (p.Length == 0) continue;
            int k = p.IndexOf('=');
            string key = k >= 0 ? p.Substring(0, k) : p;
            string val = k >= 0 ? p.Substring(k + 1) : "";
            d[Uri.UnescapeDataString(key.Replace('+', ' '))] = Uri.UnescapeDataString(val.Replace('+', ' '));
        }
        return d;
    }

    static int GetInt(Dictionary<string, string> d, string k, int def)
    {
        string v;
        return d.TryGetValue(k, out v) && v.Length > 0 ? int.Parse(v) : def;
    }

    static void Send(Stream s, int code, byte[] b, string ct)
    {
        string hd = "HTTP/1.0 " + code + " X\r\nContent-Type: " + ct + "\r\nContent-Length: " + b.Length + "\r\nConnection: close\r\n\r\n";
        byte[] hbytes = Encoding.ASCII.GetBytes(hd);
        s.Write(hbytes, 0, hbytes.Length);
        s.Write(b, 0, b.Length);
        s.Flush();
    }

    static string Run(string cmd, int t)
    {
        ProcessStartInfo p = new ProcessStartInfo("cmd.exe", "/c " + cmd);
        p.UseShellExecute = false;
        p.RedirectStandardOutput = true;
        p.RedirectStandardError = true;
        p.CreateNoWindow = true;
        Process pr = Process.Start(p);
        StringBuilder o = new StringBuilder();
        DataReceivedEventHandler add = delegate(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null) lock (o) o.AppendLine(e.Data);
        };
        pr.OutputDataReceived += add;
        pr.ErrorDataReceived += add;
        pr.BeginOutputReadLine();
        pr.BeginErrorReadLine();
        if (!pr.WaitForExit(t * 1000))
        {
            try { pr.Kill(); } catch { }
            lock (o) o.AppendLine("[timeout]");
        }
        else pr.WaitForExit();
        lock (o)
        {
            o.AppendLine("[exit " + (pr.HasExited ? pr.ExitCode.ToString() : "?") + "]");
            return o.ToString();
        }
    }


    static byte[] ListPath(string p)
    {
        StringBuilder sb = new StringBuilder();
        if (p == null || p.Length == 0 || p == "/" || p == "\\")
        {
            foreach (string d in Environment.GetLogicalDrives())
            {
                string name = d.TrimEnd('\\');
                sb.Append(name).Append('\t').Append('1').Append('\t').Append('0').Append('\t').Append('0').Append("\r\n");
            }
            return Encoding.UTF8.GetBytes(sb.ToString());
        }
        if (!Directory.Exists(p)) throw new DirectoryNotFoundException(p);
        foreach (string dir in Directory.GetDirectories(p))
        {
            try
            {
                DirectoryInfo di = new DirectoryInfo(dir);
                sb.Append(di.Name).Append('\t').Append('1').Append('\t').Append('0').Append('\t')
                  .Append(di.LastWriteTimeUtc.ToString("o")).Append("\r\n");
            }
            catch { }
        }
        foreach (string file in Directory.GetFiles(p))
        {
            try
            {
                FileInfo fi = new FileInfo(file);
                sb.Append(fi.Name).Append('\t').Append('0').Append('\t').Append(fi.Length).Append('\t')
                  .Append(fi.LastWriteTimeUtc.ToString("o")).Append("\r\n");
            }
            catch { }
        }
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    static string UniquePath(string path)
    {
        if (!File.Exists(path)) return path;
        string dir = Path.GetDirectoryName(path);
        string stem = Path.GetFileNameWithoutExtension(path);
        string ext = Path.GetExtension(path);
        for (int i = 2; i < 10000; i++)
        {
            string cand = Path.Combine(dir, stem + " (" + i + ")" + ext);
            if (!File.Exists(cand)) return cand;
        }
        throw new IOException("no unique name");
    }
    static byte[] Shot(Dictionary<string, string> qs)
    {
        Rectangle sc = Screen.PrimaryScreen.Bounds;
        int x = GetInt(qs, "x", 0), y = GetInt(qs, "y", 0);
        int w = GetInt(qs, "w", sc.Width), hh = GetInt(qs, "h", sc.Height);
        int delay = GetInt(qs, "delay", 0);
        if (delay > 0) Thread.Sleep(delay);
        using (Bitmap b = new Bitmap(w, hh, PixelFormat.Format24bppRgb))
        {
            using (Graphics g = Graphics.FromImage(b))
                {
                    IntPtr src = GetDC(IntPtr.Zero);
                    IntPtr dst = g.GetHdc();
                    try { BitBlt(dst, 0, 0, w, hh, src, x, y, 0x00CC0020 | 0x40000000); }
                    finally { g.ReleaseHdc(dst); ReleaseDC(IntPtr.Zero, src); }
                }
            MemoryStream m = new MemoryStream();
            b.Save(m, ImageFormat.Png);
            return m.ToArray();
        }
    }

    static byte[] IconPng(string file, int index, int size)
    {
        IntPtr[] hs = new IntPtr[1];
        int[] ids = new int[1];
        uint n = PrivateExtractIcons(file, index, size, size, hs, ids, 1, 0);
        if (n == 0 || hs[0] == IntPtr.Zero) throw new Exception("no icon " + file + " #" + index);
        try
        {
            using (Icon ic = Icon.FromHandle(hs[0]))
            using (Bitmap b = ic.ToBitmap())
            {
                MemoryStream m = new MemoryStream();
                b.Save(m, ImageFormat.Png);
                return m.ToArray();
            }
        }
        finally { DestroyIcon(hs[0]); }
    }
}
