////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE MAY NOT BE USED IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2007 JQL.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
//	ALTERING THE CODE IN THIS FILE COULD CAUSE THE GADGET TO STOP WORKING
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
//	TODO - The Timer stuff
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
//	GLOBAL VARIABLES
////////////////////////////////////////////////////////////////////////////////
var gAudible;
var gFadeIn;
var gInterval;
var gBreaklength;
var gLunchStartHour;
var gLunchStartMin;
var gLunchEndHour;
var gLunchEndMin;
var gBreak;
var gLunch;
var gFontName;
var gFontFamily;
var gFontSize;
var gSoundFile;
var gNextEvent = new Date();
var gOnaBreak;
var gOnLunch;
var gLunchTimer;
var gBreakTimer;
var gFadeTimer;


System.Gadget.settingsUI = "settings.html";

function initMain()
{
	/* do some initialisation */ 
	loadSettings();
    System.Gadget.onSettingsClosed = settingsClosed;
    System.Gadget.onShowSettings = noOpacity;
    checkFadeIn();
    gadgetContent.style.visibility = "hidden";
    /* Set the Timers going */
    gOnaBreak = true;
	gOnLunch = false;
    gLunchTimer = setTimeout("IsItLunchtime()",5000);
	gNextEvent = getNextEvent(gInterval);
    IsItBreaktime();
}

function settingsClosed(event)
{
    if (event.closeAction == event.Action.commit)
    {
        loadSettings();
        // reset the timer and the display
       	gOnLunch = false;	// this is all that's need to reset the lunch timer
       	gOnaBreak = true;
		gNextEvent = getNextEvent(gInterval);
	    IsItBreaktime();
        gadgetContent.style.visibility = "hidden";
    }
	checkFadeIn();
}

function checkFadeIn()
{
	if (gFadeIn == false)
	{
       	noOpacity(); 
    }
    else
    {
		TakeABreakbg.opacity = 50;
    }
}

function noOpacity()
{
	TakeABreakbg.opacity = 100; 
}

function IsItLunchtime()
{
	var Now = new Date();
	var LunchStarts = new Date();
	var LunchEnds = new Date();
	
	LunchStarts.setHours(gLunchStartHour, gLunchStartMin);
	LunchEnds.setHours(gLunchEndHour, gLunchEndMin);
	
	if (LunchEnds <= LunchStarts) 
	{
		LunchEnds.setDate(LunchEnds.getDate() + 1);
	}
	
//	if (((h>=gLunchStartHour)&&(m>=gLunchStartMin))&&((h<=gLunchEndHour)&&(m<gLunchEndMin)))
	if ((Now >= LunchStarts) && (Now < LunchEnds))
	{
		if (gOnLunch == false)
		{	// 1st time round
			gOnLunch = true;
			clearTimeout(gBreakTimer);  // stop the Break timer
			PlayaSound();
		}
		gadgetContent.innerText = gLunch;
		gadgetContent.style.visibility = "visible";
		noOpacity();
	}
	else
	{
		if (gOnLunch == true)
		{
			gadgetContent.style.visibility = "hidden";
			gOnLunch = false;
			gOnaBreak = true;
			checkFadeIn();
			gNextEvent = getNextEvent(gInterval);
		    IsItBreaktime();
		}
	} 
	
	gLunchTimer = setTimeout("IsItLunchtime()",5000);	// Check every 5 seconds - inifinte loop
}

function IsItBreaktime()
{
	clearTimeout(gBreakTimer);
	if (gOnaBreak == false)
	{	// time for a break
		gOnaBreak = true;
		PlayaSound();
		gadgetContent.innerText = gBreak;
		gadgetContent.style.visibility = "visible";
		noOpacity();
		gNextEvent = getNextEvent(gBreakLength);
	}
	else
	{	// back to work
		gadgetContent.style.visibility = "hidden";
		gOnaBreak = false;
		checkFadeIn();
		gNextEvent = getNextEvent(gInterval);
	}
    gBreakTimer = setTimeout("IsItBreaktime()",gNextEvent);
}

function getNextEvent(eventLength)
{
	return (eventLength * 60 * 1000);
}

function PlayaSound()
{
	if (gAudible == true)
	{
		try
		{
			System.Sound.playSound(gSoundFile);
		}
		catch(err)
		{
			System.Sound.beep();
		}
	}
}

function loadSettings()
{
	var sSetting = System.Gadget.Settings.read("Audible");
	if (sSetting === '')
	{
		gAudible = true;
        System.Gadget.Settings.write("Audible", gAudible);  			// write new setting
	}
	else
	{
		gAudible = !!sSetting;											// !! forces type conversion to boolean
	}

	sSetting = System.Gadget.Settings.read("FadeIn");
	if (sSetting === '')
	{
		gFadeIn = true;
        System.Gadget.Settings.write("FadeIn", gFadeIn);  				// write new setting
	}
	else
	{
		gFadeIn = !!sSetting;											// !! forces type conversion to boolean
	}
	
	// Professional Edition Settings
	sSetting = System.Gadget.Settings.read("Break");
	if (sSetting === '')
	{
		gBreak = L_BREAK_MESSAGE;
        System.Gadget.Settings.write("Break", gBreak);					// write new setting
	}
	else
	{
		gBreak = sSetting;
	}
	gadgetContent.innerText = gBreak;

	sSetting = System.Gadget.Settings.read("Lunch");
	if (sSetting === '')
	{
		gLunch = L_LUNCH_MESSAGE;
        System.Gadget.Settings.write("Lunch", gLunch);					// write new setting
	}
	else {
		gLunch = sSetting;
	}

	sSetting = System.Gadget.Settings.read("Interval");
	if ((sSetting === ''))
	{
		gInterval = 55;
        System.Gadget.Settings.write("Interval", gInterval);					// write new setting
	}
	else
	{
		gInterval = sSetting;
	}

	sSetting = System.Gadget.Settings.read("BreakLength");
	if ((sSetting === ''))
	{
		gBreakLength = 5;
        System.Gadget.Settings.write("BreakLength", gBreakLength);					// write new setting
	}
	else
	{
		gBreakLength = sSetting;
	}

	sSetting = System.Gadget.Settings.read("LunchStartHour");
	if ((sSetting === ''))
	{
		gLunchStartHour = 13;
        System.Gadget.Settings.write("LunchStartHour", gLunchStartHour);					// write new setting
	}
	else
	{
		gLunchStartHour = sSetting;
	}

	sSetting = System.Gadget.Settings.read("LunchStartMin");
	if ((sSetting === ''))
	{
		gLunchStartMin = 0;
        System.Gadget.Settings.write("LunchStartMin", gLunchStartMin);					// write new setting
	}
	else
	{
		gLunchStartMin = sSetting;
	}

	sSetting = System.Gadget.Settings.read("LunchEndHour");
	if ((sSetting === ''))
	{
		gLunchEndHour = 13;
        System.Gadget.Settings.write("LunchEndHour", gLunchEndHour);					// write new setting
	}
	else
	{
		gLunchEndHour = sSetting;
	}

	sSetting = System.Gadget.Settings.read("LunchEndMin");
	if ((sSetting === ''))
	{
		gLunchEndMin = 30;
        System.Gadget.Settings.write("LunchEndMin", gLunchEndMin);					// write new setting
	}
	else
	{
		gLunchEndMin = sSetting;
	}

	sSetting = System.Gadget.Settings.read("FontName");
	if (sSetting === '')
	{
		gFontName = L_FONTNAME;
        System.Gadget.Settings.write("FontName", gFontName);					// write new setting
	}
	else
	{
		gFontName = sSetting;
	}
	// Get the index of the font name in the fontArray and set the FontFamilyArray to the same index
    for (var i = 0; i < fontArray.length; i++)
    {
        if (fontArray[i].toLowerCase() == gFontName.toLowerCase())
        {
            gFontFamily = FontFamilyArray[i];
        }

    }
	if (gFontFamily == '')
	{
		gFontFamily = "Calibri, Arial, Helvetica, sans-serif";
	}
	gadgetContent.style.fontFamily = gFontFamily;
	
	sSetting = System.Gadget.Settings.read("FontSize");
	if (sSetting === '')
	{
		gFontSize = L_FONTSIZE;
        System.Gadget.Settings.write("FontSize", gFontSize);					// write new setting
	}
	else
	{
		gFontSize = sSetting;
	} 
	gadgetContent.style.fontSize = gFontSize;

	sSetting = System.Gadget.Settings.read("SoundFile");
	if (sSetting === '')
	{
		gSoundFile = L_SOUND_FILE;
        System.Gadget.Settings.write("SoundFile", gSoundFile);					// write new setting
	}
	else
	{
		gSoundFile = sSetting;
	} 
}
