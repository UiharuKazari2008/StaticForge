async function run() {
    try {
        // Suppress DEP0044 since node fetch without certs often fails, so add unathorized flag
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        const res = await fetch('https://yozora.bluesteel.737.jp.net/api/v1/repos/DreamScape/StaticForge/pulls/294', {
            headers: { 'User-Agent': 'Node.js' }
        });
        const pr = await res.json();
        console.log(pr.merge_commit_sha, pr.head?.sha);
        console.log("commits?", pr.commits);

        // try to list commits for pr 294
        const commitsRes = await fetch('https://yozora.bluesteel.737.jp.net/api/v1/repos/DreamScape/StaticForge/pulls/294/commits', {
            headers: { 'User-Agent': 'Node.js' }
        });
        const commits = await commitsRes.json();
        if (Array.isArray(commits)) {
             console.log("commit shas: ", commits.map(c => c.sha));
        }
    } catch(e) {
        console.error(e);
    }
}
run();
