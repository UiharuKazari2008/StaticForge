// Modal utility functions
const backdrop = document.querySelector('.modal-backdrop');

function openModal(modal) {
    if (!modal) return;

    // Check if this is the first modal opening
    const otherOpenModals = Array.from(document.querySelectorAll('.modal')).filter(m => m !== modal && !m.classList.contains('hidden'));
    const isFirstModal = otherOpenModals.length === 0;

    // If this is the first modal, animate the backdrop in
    if (isFirstModal && backdrop) {
        backdrop.classList.remove('fade-out');
        backdrop.classList.add('fade-in');
    }

    // Add opening class to trigger animation
    modal.classList.add('opening');
    // Remove hidden class to show modal
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');

    // Remove opening class after animation completes
    setTimeout(() => {
        modal.classList.remove('opening');
    }, 300); // Match animation duration
}

function closeModal(modal) {
    if (!modal) return;

    // Check if this is the last modal closing
    const otherOpenModals = Array.from(document.querySelectorAll('.modal')).filter(m => m !== modal && !m.classList.contains('hidden'));
    const isLastModal = otherOpenModals.length === 0;

    // Add closing class to trigger animation
    modal.classList.add('closing');

    // If this is the last modal, animate the backdrop out
    if (isLastModal && backdrop) {
        backdrop.classList.add('fade-out');
        // Remove fade-in class after a short delay to let fade-out animation start
        setTimeout(() => {
            backdrop.classList.remove('fade-in');
        }, 50);
    }

    // Wait for animation to complete before hiding
    setTimeout(() => {
        // Add hidden class to hide modal
        modal.classList.add('hidden');
        // Remove closing class
        modal.classList.remove('closing');

        // Only remove modal-open if no other modals (excluding the current one) are open
        if (isLastModal) {
            document.body.classList.remove('modal-open');
            // Reset backdrop after modal is hidden
            if (backdrop) {
                setTimeout(() => {
                    backdrop.classList.remove('fade-out');
                }, 300);
            }
        }
    }, 300); // Match animation duration
} 