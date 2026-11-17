// Windows parent PIDs alone miss MSYS exec replacements in Git hooks. Take a
// Toolhelp snapshot (no WMI service) and add Git's own msys PID -> WINPID edges.
using System;
using System.IO;
using System.Collections.Generic;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

class GitTree {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Entry {
        public uint size, usage, pid;
        public UIntPtr heap;
        public uint module, threads, parent;
        public int priority;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string name;
    }
    [DllImport("kernel32",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
    [DllImport("kernel32",CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h,ref Entry entry);
    [DllImport("kernel32",CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr h,ref Entry entry);
    [DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);
    static void Edge(Dictionary<int,List<int>> edges,int parent,int child) {
        List<int> list;
        if(!edges.TryGetValue(parent,out list)) edges[parent]=list=new List<int>();
        list.Add(child);
    }
    static Dictionary<int,List<int>> Snapshot(string msys) {
        var edges=new Dictionary<int,List<int>>();
        IntPtr h=CreateToolhelp32Snapshot(2,0);
        if(h==new IntPtr(-1))throw new Win32Exception();
        try {
            var e=new Entry(); e.size=(uint)Marshal.SizeOf(typeof(Entry));
            if(!Process32FirstW(h,ref e))throw new Win32Exception();
            do { Edge(edges,(int)e.parent,(int)e.pid); } while(Process32NextW(h,ref e));
        } finally {CloseHandle(h);}
        if(msys!=null){
            var options=new ProcessStartInfo(msys,"-W"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true};
            options.EnvironmentVariables["COLUMNS"]="4096";
            using(var ps=Process.Start(options)){
                var ids=new Dictionary<int,int>();
                var parents=new Dictionary<int,int>();
                string line;
                while((line=ps.StandardOutput.ReadLine())!=null){
                    var m=Regex.Match(line,@"^\s*[SIO]?\s*(\d+)\s+(\d+)\s+\d+\s+(\d+)\s+");
                    if(!m.Success)continue;
                    int logical=int.Parse(m.Groups[1].Value), win=int.Parse(m.Groups[3].Value);
                    ids[logical]=win;parents[win]=int.Parse(m.Groups[2].Value);
                }
                foreach(var pair in parents){int parent;if(ids.TryGetValue(pair.Value,out parent))Edge(edges,parent,pair.Key);}
            }
        }
        return edges;
    }
    static int Main(string[] args) {
        int pid;
        if(args.Length!=1 || !int.TryParse(args[0],out pid) || pid<=0)return 1;
        try {
            using(var root=Process.GetProcessById(pid)){
                // Retain handles to selected processes so a reused PID is never
                // used as the starting point of a subsequent kill pass.
                var known=new Dictionary<int,Process>();
                try {
                    var handle=root.Handle;
                    known.Add(pid,root);
                    string msys=null;
                    var dir=new FileInfo(root.MainModule.FileName).Directory;
                    for(int i=0;i<5 && dir!=null;i++,dir=dir.Parent){
                        string file=Path.Combine(dir.FullName,@"usr\bin\ps.exe");
                        if(File.Exists(file)){msys=file;break;}
                    }
                    for(int pass=0;pass<3;pass++){
                        var edges=Snapshot(msys);
                        var queue=new Queue<int>(known.Keys);var order=new List<Process>();
                        while(queue.Count>0){
                            int parent=queue.Dequeue();List<int> children;
                            if(!edges.TryGetValue(parent,out children))continue;
                            foreach(int id in children){
                                if(id<=0 || known.ContainsKey(id))continue;
                                try{
                                    var process=Process.GetProcessById(id);
                                    var hold=process.Handle;
                                    known.Add(id,process);queue.Enqueue(id);order.Add(process);
                                }catch(ArgumentException){}catch(InvalidOperationException){}
                            }
                        }
                        order.Reverse();
                        foreach(var process in order) if(!process.HasExited)try{process.Kill();}catch(InvalidOperationException){}
                        if(!root.HasExited)try{root.Kill();}catch(InvalidOperationException){}
                        if(pass<2)System.Threading.Thread.Sleep(50);
                    }
                    return 0;
                }finally{foreach(var p in known.Values)if(p!=root)p.Dispose();}
            }
        }catch(ArgumentException){return 0;}catch{return 1;}
    }
}
