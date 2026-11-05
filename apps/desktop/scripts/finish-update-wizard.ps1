# Disposable Windows runner only. Select the active Next/Install/Finish
# button in the installer verified by the published SHA (or its NSIS child).
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Disposable runner required' }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public class Wizard {
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h,int id);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder buf,int n);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint msg,IntPtr w,IntPtr l);
    public static IntPtr[] All(){var a=new List<IntPtr>(); EnumWindows((h,p)=>{a.Add(h);return true;},IntPtr.Zero);return a.ToArray();}
    public static string Label(IntPtr h){var s=new StringBuilder(256);GetWindowText(h,s,256);return s.ToString();}
    public static int Owner(IntPtr h){uint id;GetWindowThreadProcessId(h,out id);return (int)id;}
}
'@
$until=(Get-Date).AddMinutes(3)
$hashes=@{}
$seen=@{}
do {
    $rows=@(Get-CimInstance Win32_Process)
    if ($rows | Where-Object { $_.ExecutablePath -eq $env:ALUNE_EXPECTED_EXECUTABLE }) { exit 0 }
    $trusted=@{}
    foreach ($r in $rows) {
        $file=$r.ExecutablePath
        if(!$file -or $r.CommandLine -notmatch '(?:^|\s)--updated(?:\s|$)'){continue}
        if(!$hashes.ContainsKey($file)) {
            try {
                $stream=[IO.File]::OpenRead($file)
                try {$hashes[$file]=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
                finally{$stream.Dispose()}
            }catch{continue}
        }
        if($hashes[$file] -eq $env:ALUNE_EXPECTED_DIGEST){$trusted[[int]$r.ProcessId]=$true}
    }
    do {
        $count=$trusted.Count
        foreach($r in $rows){if($trusted.ContainsKey([int]$r.ParentProcessId)){$trusted[[int]$r.ProcessId]=$true}}
    }while($trusted.Count -gt $count)
    foreach($h in [Wizard]::All()){
        $pidForWindow=[Wizard]::Owner($h)
        if(!$trusted.ContainsKey($pidForWindow) -or ![Wizard]::IsWindowVisible($h)){continue}
        $ok=[Wizard]::GetDlgItem($h,1)
        $label=[Wizard]::Label($ok)
        $key=[string]$pidForWindow+' '+[Wizard]::Label($h)+' '+$label
        if(!$seen.ContainsKey($key)){Write-Output ('Verified installer UI: '+$key);$seen[$key]=$true}
        if($ok -ne [IntPtr]::Zero -and [Wizard]::IsWindowEnabled($ok) -and $label -match 'Next|Install|Finish|Close|下一步|安装|完成|关闭'){
            [void][Wizard]::PostMessage($h,0x0111,[IntPtr]1,$ok)
        }
    }
    Start-Sleep -Milliseconds 650
}while((Get-Date) -lt $until)
throw ('Windows update did not relaunch the custom installation. Verified wizard states: '+($seen.Keys -join '; '))
