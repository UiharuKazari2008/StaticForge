/**
 * Legacy IP Management shim — redirects to Security Center DSAP.
 * openSecurityCenterDsap: public/scripts/comp/securityCenterDsapApplet.js
 */

class IPManagementSystem {
    async openIPManagementModal() {
        const userType = localStorage.getItem('userType');
        if (userType !== 'admin') {
            showGlassToast('error', 'Access Denied', 'Admin access required for Security Center', false, 5000, '<i class="fas fa-lock"></i>');
            return;
        }
        if (typeof openSecurityCenterDsap === 'function') {
            openSecurityCenterDsap('blocked');
            return;
        }
        if (typeof openDsapInGrimoire === 'function') {
            openDsapInGrimoire('dsap://security.dreamscape.jp/');
            return;
        }
        showGlassToast('error', 'Error', 'Security Center is not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

ipManagement = new IPManagementSystem();
