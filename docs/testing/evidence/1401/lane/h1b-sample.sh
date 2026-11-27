e=$(( $(date +%s) + 85 )); while [ $(date +%s) -lt $e ]; do echo "$(date +%T.%3N) $(cmd phone get-allowed-network-types-for-users -s 0)"; sleep 1; done
