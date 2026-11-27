E=/home/kanmi/staticforge/docs/testing/evidence/1379/aemu-fold-2-s6
S=/tmp/claude-1000/-home-kanmi-staticforge/e45cc6db-a077-4200-88cc-d5c5dd91ed64/scratchpad/s6
cd /home/kanmi/staticforge
L="scripts/aemu-lane/lane.sh --agent claude-e45cc6db aemu-fold-2"
lg() { echo "[$(date +%H:%M:%S)] $*" | tee -a $E/log.txt; }
run() { lg "\$ $*"; "$@" 2>&1 | tee -a $E/log.txt; }
