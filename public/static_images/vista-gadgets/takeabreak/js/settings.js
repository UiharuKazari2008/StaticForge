////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE MAY NOT BE USED IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2007 JQL.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
//	ALTERING THE CODE IN THIS FILE COULD CAUSE THE GADGET TO STOP WORKING
////////////////////////////////////////////////////////////////////////////////


function init()
{
	/* do some initialisation */ 
	setFormText();
}

System.Gadget.onSettingsClosing = SettingsClosing; 

function SettingsClosing(event)
{ 
	if (event.closeAction == event.Action.commit)
	{
		/* do something to close down */
		writeSettings();
	}
	event.cancel = false;
}

function setFormText()
{
	chbxAudible.title = L_AUDIBLE_ALT;
	lblAudible.innerText = L_AUDIBLE_CAPTION;
	lblAudible.title = L_AUDIBLE_ALT; 
	chbxFadeIn.title = L_FADEIN_ALT;
	lblFadeIn.innerText = L_FADEIN_CAPTION;
	lblFadeIn.title = L_FADEIN_ALT;
	btnHelp.value = L_HELP_CAPTION;
	btnHelp.title = L_HELP_ALT;
	jqlGadget.title = L_JQLGADGET_ALT;
	jqlGadget.href = unescape(L_JQLGADGET_HREF);
	jqlGadget.innerText = unescape(L_JQLGADGET_CAPTION);
	
	chbxAudible.checked = System.Gadget.Settings.read("Audible");
	chbxFadeIn.checked = System.Gadget.Settings.read("FadeIn");
} 

function writeSettings()
{
	System.Gadget.Settings.write("Audible", chbxAudible.checked);
	System.Gadget.Settings.write("FadeIn", chbxFadeIn.checked);
}

function openHelp()
{
	var helpPath = System.Gadget.path + "../help/help.html";
	window.open(helpPath, "_blank");
}
