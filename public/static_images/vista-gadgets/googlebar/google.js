System.Gadget.onUndock = undockedState;
System.Gadget.onDock = dockedState;

function undockedState()
{
System.Gadget.beginTransition();
	with(document.body.style)
		width=200,
		fontSize="17px",
		backgroundImage="url('background_desktop.png')";
	query.size=25;
System.Gadget.endTransition(System.Gadget.TransitionType.none,0);
}

function dockedState()
{
System.Gadget.beginTransition();
	with(document.body.style)
		width=130,
		fontSize="14px";
	query.size=14;
System.Gadget.endTransition(System.Gadget.TransitionType.none,0);
}