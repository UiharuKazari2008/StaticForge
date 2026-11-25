#!/bin/bash
# DSApp merge: origin/main + every unmerged origin branch -> build/latest in the clone given as $1 (#821).
# Called by modules/androidBuilds.js on the server's own clone (data/android-builds/repo). Does only the
# fetch + merge + conflict-resolve part: no checkout of another branch, no scp/ssh, no push (the module pushes).
# Prints one line per branch: "ok <origin/branch>" or "resolved <origin/branch>" (and "reused ..." for a file);
# on a conflict nobody resolved it aborts the merge and prints "UNEXPECTED conflict <branch>: <file>" with exit 1.
# The resolvers below are copied from ~/.cache/claude-run/dsapp-joint-build.sh (the manual joint build) by script.
# Known conflicts: ActiveSyncNotifications.kt and MainActivity.kt (additive: keep both; the compile checks it), strings.xml service description (both disclosures).
set -u
CLONE="${1:?usage: dsapp-merge-latest.sh <clone dir>}"
cd "$CLONE" || exit 1
# DSAPP_MERGE_SKIP: optional extended regex of origin branches to leave out (config androidBuilds.skipBranches)
SKIP="${DSAPP_MERGE_SKIP:-^\$}"
G() { git -c user.name="Claude Code" -c user.email="claude@yozora.bluesteel.737.jp.net" "$@"; }
git fetch -q --prune origin && git checkout -q -f -B build/latest origin/main || exit 1
for b in $(git branch -r --no-merged origin/main | grep -v -e HEAD -e 'origin/build/' -e 'origin/tmp/' | sed 's/^[ *]*//' | grep -v -E "$SKIP"); do
  G merge -q --no-edit "$b" >/dev/null 2>&1; MRC=$?
  if [ $MRC != 0 ] && ! git ls-files -u | grep -q .; then echo "UNEXPECTED conflict $b: merge failed without conflicting files"; git merge --abort 2>/dev/null; exit 1; fi
  if git ls-files -u | grep -q .; then
    for F in $(git diff --name-only --diff-filter=U); do
      case "$F" in
        */ActiveSyncNotifications.kt|*/MainActivity.kt|*/ActiveSyncLink.kt|app/build.gradle.kts|gradle/libs.versions.toml|docs/*.md)
          python3 - "$F" <<'PY' || { echo "UNEXPECTED conflict $b: $F"; git merge --abort; exit 1; }
import re,sys
p=sys.argv[1]; s=open(p).read()
QUOTED=re.compile(r'"([^"]+)"')
def keyof(line):
    t=line.strip()
    m=re.match(r'([A-Za-z_][\w.?]*)\s*=\s*[A-Za-z_]', t)
    return m.group(1) if m else None
def resolve(m):
    head, theirs = m.group(1), m.group(2)
    # an ops list on both sides ("a", "b", ...)): one list, HEAD's order, then the new ops from the other side
    if 'JSONArray(listOf(' in s and head.count('"') >= 4 and theirs.count('"') >= 4 and head.rstrip().endswith('))') and theirs.rstrip().endswith('))'):
        have=set(QUOTED.findall(head))
        extra=[q for q in QUOTED.findall(theirs) if q not in have]
        if not extra: return head
        body=head.rstrip()
        body=body[:-2] + ',\n            ' + ', '.join('"%s"' % q for q in extra) + '))'
        return body + '\n'
    # the same assignment on both sides (x = Foo(...)): HEAD's line is the newer merge, drop the other's copy
    hk={keyof(l) for l in head.splitlines() if keyof(l)}
    kept=[l for l in theirs.splitlines(True) if not (keyof(l) and keyof(l) in hk)]
    return head + ''.join(kept)
s=re.sub(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", resolve, s, flags=re.S)
assert '<<<<<<<' not in s; open(p,'w').write(s)
PY
          ;;
        app/src/main/res/values/strings.xml)
          python3 - "$F" <<'PY' || { echo "UNEXPECTED conflict $b: $F"; git merge --abort; exit 1; }
import re,sys
p=sys.argv[1]; s=open(p).read()
combined="""    <string name="melaton_bars_description">Draws Melaton Mobile\\'s title bar and soft key bar over other programs in place of Android\\'s status bar. It reads which program is in front (for its title) and whether the keyboard is up. Only when you choose Import from Samsung Wallet in Melaton Mobile\\'s Wallet does it read Samsung Wallet\\'s card list and take pictures of your cards there; they stay on this phone, encrypted. With the Windows Mobile lock screen on (Melaton Mobile Settings), it shows that lock screen over Android\\'s and types the PIN you enter on its keypad into Android\\'s own PIN pad; the PIN is never kept. Nothing else on the screen is read. With Use WM Volume popup in Android on, it takes the volume keys over other programs to show Melaton\\'s volume control; no other keys are read. While Melaton\\'s desktop is open on a DeX screen, it reads which programs have windows on that screen (their names and window titles) for Melaton\\'s taskbar, and when you choose Minimise or Close on a taskbar button it presses that window\\'s own button; nothing is kept or sent.</string>
"""
def fix(m):
    if 'melaton_bars_description' in m.group(0): return combined
    raise SystemExit('unexpected strings conflict')
s=re.sub(r"<<<<<<< HEAD\n.*?>>>>>>> [^\n]*\n", fix, s, flags=re.S)
assert '<<<<<<<' not in s; open(p,'w').write(s)
PY
          ;;
        *)
          # resolved before (Nov 21 2026): the last build/latest already holds every unmerged branch that touches this
          # file and main has not changed it since, so that build's hand-made resolution is reused as it is
          REUSE=1
          git diff --quiet "$(git merge-base origin/main origin/build/latest)" origin/main -- "$F" || REUSE=0
          for ob in $(git branch -r --no-merged origin/main | grep -v -e HEAD -e 'origin/build/' -e 'origin/tmp/' | sed 's/^[ *]*//' | grep -v -E "$SKIP"); do
            if [ -n "$(git diff --name-only origin/main...$ob -- "$F")" ] && ! git merge-base --is-ancestor "$ob" origin/build/latest; then REUSE=0; fi
          done
          if [ $REUSE = 1 ] && git show origin/build/latest:"$F" > "$F"; then echo "reused build/latest's resolution of $F"
          else echo "UNEXPECTED conflict $b: $F"; git merge --abort; exit 1; fi ;;
      esac
    done
    git add -A && G commit -qm "Merge $b (known conflicts resolved: both kept)"; echo "resolved $b"
  else echo "ok $b"; fi
done
