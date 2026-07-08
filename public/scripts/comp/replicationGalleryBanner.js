/**
 * Replication gallery connectivity banner — child/ephemeral + normal + unreachable only.
 * assetUrlResolver.js, galleryView.js
 */

const REPLICATION_GALLERY_BANNER_ID = 'replicationGalleryBanner';

function ensureReplicationGalleryBannerElement() {
    let banner = document.getElementById(REPLICATION_GALLERY_BANNER_ID);
    if (banner) return banner;

    const gallery = document.getElementById('gallery');
    if (!gallery || !gallery.parentNode) return null;

    banner = document.createElement('div');
    banner.id = REPLICATION_GALLERY_BANNER_ID;
    banner.className = 'replication-gallery-banner hidden';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<i class="fas fa-cloud-slash replication-gallery-banner-icon" aria-hidden="true"></i><span class="replication-gallery-banner-text"></span>';
    gallery.parentNode.insertBefore(banner, gallery);
    return banner;
}

function formatReplicationGalleryBannerText(warning) {
    if (!warning) return '';
    const name = warning.masterDisplayName || 'Master';
    const localCount = typeof warning.localCount === 'number' ? warning.localCount : 0;
    const remoteHidden = typeof warning.remoteHiddenCount === 'number' ? warning.remoteHiddenCount : 0;
    return `${name} is currently inaccessible — showing ${localCount} local generation${localCount === 1 ? '' : 's'} only (${remoteHidden} remote hidden)`;
}

function updateReplicationGalleryBanner(warning) {
    const ctx = getGalleryReplicationContext && getGalleryReplicationContext();
    if (ctx && (ctx.role === 'standalone' || ctx.role === 'master' || ctx.connectivity === 'airgapped')) {
        hideReplicationGalleryBanner();
        return;
    }
    if (!warning) {
        hideReplicationGalleryBanner();
        return;
    }

    const banner = ensureReplicationGalleryBannerElement();
    if (!banner) return;

    const textEl = banner.querySelector('.replication-gallery-banner-text');
    if (textEl) {
        textEl.textContent = formatReplicationGalleryBannerText(warning);
    }
    banner.classList.remove('hidden');
}

function hideReplicationGalleryBanner() {
    const banner = document.getElementById(REPLICATION_GALLERY_BANNER_ID);
    if (banner) {
        banner.classList.add('hidden');
    }
}

function applyGalleryReplicationResponse(data) {
    if (!data || typeof data !== 'object') return;

    if (data.replicationContext) {
        applyGalleryReplicationContext(data.replicationContext);
    }

    if (data.replicationWarning) {
        updateReplicationGalleryBanner(data.replicationWarning);
    } else {
        hideReplicationGalleryBanner();
    }
}
