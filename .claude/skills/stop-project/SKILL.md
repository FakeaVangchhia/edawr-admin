---
name: stop-project
description: Stop everything eDawr is running locally — the Django API on 8000, the storefront on 3000, the admin console on 3001, Expo/Metro on 8081 — and prove the ports came free. Use when asked to stop, kill, shut down or restart the project, before a `manage.py test` run, or when a port is already in use and you do not know what is holding it.
argument-hint: "[all | api | store | console | rider | --postgres]"
disable-model-invocation: true
allowed-tools: Bash, PowerShell, Read
---

Stop `$ARGUMENTS`. Empty means **all four dev servers**. PostgreSQL is left
running unless `--postgres` is passed — see below.

## What is running right now

```!
echo "── ports ──"
for p in 8000 3000 3001 8081; do
  case $p in 8000) w="API";; 3000) w="storefront";; 3001) w="console";; 8081) w="expo/metro";; esac
  pid=$(netstat -ano 2>/dev/null | grep ":$p .*LISTENING" | head -1 | awk '{print $NF}')
  printf "  %-5s %-11s %s\n" "$p" "$w" "$([ -n "$pid" ] && echo "held by PID $pid" || echo free)"
done
echo "── eDawr processes ──"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { (\$_.CommandLine -like '*eDawr*' -or \$_.CommandLine -like '*manage.py runserver*') -and \$_.CommandLine -notlike '*claude*' } | ForEach-Object { '  {0,-6} {1}' -f \$_.ProcessId, \$_.CommandLine.Substring(0, [Math]::Min(90, \$_.CommandLine.Length)) }" 2>/dev/null
```

If that lists nothing and every port is free, nothing is running — say so and
stop. Do not go hunting.

## Stop them

Kill by **command line, not by port**. Each dev server is a small tree — `uv` →
`python` → the autoreloader → the worker for the API, `npm` → `next dev` →
`start-server` → a build worker for each web app — and only the leaf holds the
socket. Kill the leaf alone and Django's autoreloader or Next's supervisor
starts a fresh one, so the port never comes free and it looks like the kill
failed.

Every process in those trees carries `F:\Projects\eDawr` in its command line,
which is what makes one predicate enough:

```powershell
$root  = 'F:\Projects\eDawr'
$ports = 8000, 3000, 3001, 8081

$match = {
  ($_.CommandLine -like "*$root*" -or $_.CommandLine -like '*manage.py runserver*') -and
   $_.CommandLine -notlike '*claude*' -and $_.ProcessId -ne $PID
}

foreach ($pass in 1..2) {
  $procs = @(Get-CimInstance Win32_Process | Where-Object $match)
  $owners = foreach ($p in $ports) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" } |
      Where-Object $match
  }
  $kill = @($procs) + @($owners) | Sort-Object ProcessId -Unique
  if (-not $kill) { break }
  $kill | ForEach-Object {
    "stopping {0,-6} {1}" -f $_.ProcessId, $_.Name
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
```

Two passes, because pass one can race a supervisor that respawns a worker
between the enumeration and the kill. Pass two finds the orphan and finishes it.

`-notlike '*claude*'` is not cosmetic. Claude Code is itself a `node` process
whose working directory is this repo; a predicate loose enough to match it kills
the session doing the killing.

**Only one service?** Narrow it by directory rather than by port — `*\backend*`
for the API, `*\frontend*` for the storefront, `*\admin*` for the console,
`*\mobile*` for Expo — and keep the rest of the script as it is.

## Then prove it

A stop that is not verified is a guess. The ports are the evidence:

```bash
for p in 8000 3000 3001 8081; do
  printf "  %-5s %s\n" "$p" "$(netstat -ano 2>/dev/null | grep -q ":$p .*LISTENING" && echo STILL-IN-USE || echo free)"
done
```

Report the table. If a port is still held after both passes, it is something
outside this repo — find the owner (`netstat -ano | grep ":3000 "`, then
`Get-Process -Id <pid>`) and tell the user what it is rather than killing a
process you cannot account for.

Claude Code's own background-task entries also go stale here: a task started
with `run_in_background` is reported as finished once its process dies, and its
log file stays readable afterwards. Nothing extra to clean up.

## PostgreSQL stays up

`postgresql-x64-18` is a Windows service, it is shared with anything else on
this machine, and it starts on boot — stopping it is not part of stopping
eDawr, and the next `manage.py` command would just fail with a connection
error. Stop it only when explicitly asked:

```bash
powershell -NoProfile -Command "Stop-Service postgresql-x64-18"   # needs elevation
```

Note that this is the one step in the skill that needs an **elevated** shell,
and that `Start-Service postgresql-x64-18` brings it back.

## Why stop before a test run

`manage.py test` builds `test_edawr` and drops it at the end. A `runserver`
holding connections to the same cluster does not block that, but a dev server
that autoreloads mid-suite competes for the same rows and turns a green suite
intermittently red. Stop first, run the 351 tests, start again with
`/run-project`.
