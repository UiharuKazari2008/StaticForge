function loadMain() {
  	gDockFlag = System.Gadget.docked;
	gFlyOpenFlag = System.Gadget.Flyout.show;

	System.Gadget.Flyout.file = "flyout.html";
	System.Gadget.Flyout.onShow = procFlyoutShowEvent;
	System.Gadget.Flyout.onHide = procFlyoutHideEvent;

	/* layout */
	System.Gadget.background="url(images/130x100.png)";
	document.body.focus();

	try {
		System.Gadget.settingsUI = "settings.html";
	}
	catch (ex) {
		// running in browser, no System.Gadget namespace available
	}
}
function settingsClosing(event) {
    if (event.closeAction == event.Action.commit) {   
		// opslaan
    }
}
function loadSettings() {
	// ophalen van settings
}

function procFlyoutShowEvent()
{
  gFlyOpenFlag = true;
}

function procFlyoutHideEvent()
{
  gFlyOpenFlag = false;
}

function doProcFlyoutOpen()
{
	// save string
	setSetting("string2hash", findDOM('string').value);
	// open flyout
	gFlyOpenFlag = true;
	System.Gadget.Flyout.show = true;
}