/**
 * Legacy IP Management shim: Melaton Defender's Quarantined items (#831: the Security Center DSAP page is retired).
 * openSecurityCenterDsap: public/scripts/comp/dsapManifests.js
 */

class IPManagementSystem {
    async openIPManagementModal() {
        const userType = localStorage.getItem('userType');
        if (userType !== 'admin') {
            showGlassToast('error', 'Access Denied', 'Admin access required for Security Center', false, 5000, '<i class="fas fa-lock"></i>');
            return;
        }
        if (typeof openSecurityCenterDsap === 'function') {
            void openSecurityCenterDsap('blocked');
            return;
        }
        showGlassToast('error', 'Error', 'Security Center is not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

ipManagement = new IPManagementSystem();
