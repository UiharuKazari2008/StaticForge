/*
 * Melaton Weather on the desktop (#1001): window.wmWeather until the program is first opened.
 *
 * wmWeather.js is the phone's Weather (Melaton Mobile loads it at boot: Today, the 6.5 home screen and the status bar
 * read it). On the desktop it is only the Melaton Weather window, so it is featureLoader feature 'melaton_weather'
 * (with wm-weather.css) and loads on the first open: from the service worker's copy when there is no server. This
 * stands in for it with the calls the desktop makes - the Start menu and the Sidebar's Weather (openDesktop),
 * Continuity's hand-over and weather alerts' View / Open Weather (open, showAlert) - and each loads the program first.
 * wmWeather.js then replaces window.wmWeather with itself.
 */
(function (root) {
    'use strict';

    if (root.uiShell === 'mobile' || root.wmWeather) return;

    let loading = null;
    const stub = {};
    /** The program's own wmWeather, loaded (null if it could not be). */
    function program() {
        if (root.wmWeather && root.wmWeather !== stub) return Promise.resolve(root.wmWeather);
        if (!root.featureLoader) return Promise.resolve(null);
        if (!loading) {
            loading = root.featureLoader.loadFeature('melaton_weather')
                .then(() => (root.wmWeather && root.wmWeather !== stub ? root.wmWeather : null))
                .finally(() => { loading = null; });
        }
        return loading;
    }
    const call = (name) => (...args) => program().then((w) => (w && typeof w[name] === 'function' ? w[name](...args) : undefined));

    Object.assign(stub, {
        /** Melaton Weather's desktop window (the Start menu, the Sidebar's Weather) */
        openDesktop: call('openDesktop'),
        open: call('open'),
        /** a broadcast alert on the program's Alert page (weatherAlerts.js) */
        showAlert: call('showAlert'),
        showAlerts: call('showAlerts')
    });
    root.wmWeather = stub;
})(typeof window !== 'undefined' ? window : globalThis);
