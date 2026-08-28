/**
 * Dreamscape home landing — dreamscape.jp
 * Links to DSAP tools and Grimoire surfaces. Uses DSAP-SMF chrome.
 * Depends on: dsapRegistry.js, dsapSmfMarkup.js
 */

const DREAMSCAPE_HOME_URL = 'dreamscape.jp';

const dreamscapeHomeDriver = {
    init(host) {
        const root = host.getRoot();
        if (!root) return;

        root.querySelectorAll('[data-dsap-smf-home-link]').forEach((link) => {
            if (link.dataset.dsapSmfHomeWired === '1') return;
            link.dataset.dsapSmfHomeWired = '1';
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = link.getAttribute('data-dsap-smf-home-link') || link.getAttribute('href');
                if (target && typeof host.navigate === 'function') {
                    host.navigate(target);
                }
            });
        });

        if (typeof host.shell?.setAddress === 'function') {
            host.shell.setAddress({ displayUrl: 'dsap://dreamscape.jp/', mode: 'dsap' });
        }
    },

    refresh(host) {
        this.init(host);
    },

    destroy() {}
};

function registerDreamscapeHomeDsap() {
    // registerDsap: public/scripts/comp/dsapRegistry.js
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: DREAMSCAPE_HOME_URL,
        aliases: [
            'dreamscape.jp/',
            'www.dreamscape.jp',
            'www.dreamscape.jp/',
            'dyna.dreamscape.jp',
            'dyna.dreamscape.jp/',
            `dsap://${DREAMSCAPE_HOME_URL}`,
            `dsap://${DREAMSCAPE_HOME_URL}/`
        ],
        type: 'core',
        title: 'Dreamscape',
        theme: 'dsap-smf',
        getContent() {
            return {
                html: dsapSmfBuildDreamscapeHomeHtml(),
                css: '',
                drivers: dreamscapeHomeDriver,
                baseBackground: '#eeeeee'
            };
        },
        menuEntry: {
            launchId: 'control-panel',
            icon: 'fas fa-gauge',
            text: 'Control Panel',
            fullName: 'Dreamscape System Control Panel',
            appMenu: true,
            startMenu: true,
            startMenuIndex: 5,
            launch() {
                openDsapInGrimoire(`dsap://${DREAMSCAPE_HOME_URL}/`);
            }
        }
    });
}

registerDreamscapeHomeDsap();

function openDreamscapeHomeDsap() {
    openDsapInGrimoire(`dsap://${DREAMSCAPE_HOME_URL}/`);
}
