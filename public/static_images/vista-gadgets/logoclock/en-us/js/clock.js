////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////
var bounceDistance             = 3;
var newPositionMinutes         = 0;
var currentPositionMinutes     = 0;
var newPositionHours           = 0;
var currentPositionHours       = 0;
var midClockNameFontHeight     = 8;
var maxClockNameWidth          = 60;
var posClockNameTop            = 30;
var posDigitalReadoutTop       = 70;
var clockPartsHeight;
var clockPartsTop;
var clockPartsLeft;
var date;
var intervalTime;
var newTimeOut;
var stopPositionHours;
var stopPositionMinutes;
var clockFont;
var clockFontColor;
var clockFontSize;
var loadAnimation = false;
////////////////////////////////////////////////////////////////////////////////
//
// load initial settings
//
////////////////////////////////////////////////////////////////////////////////
function loadMain()
{
    settingsChanged();

    System.Gadget.settingsUI = "settings.html";
    System.Gadget.onSettingsClosed = settingsClosed;
    
    System.Gadget.visibilityChanged = visibilityChanged;
    
    h.addShadow("grey", 2, 40, 2, 2);
    m.addShadow("grey", 2, 40, 2, 2);
    s.addShadow("grey", 2, 40, 2, 2);
}
////////////////////////////////////////////////////////////////////////////////
//
// set theme images
//
////////////////////////////////////////////////////////////////////////////////
function setImages()
{
    var curTheme = clockThemes[mySetting.themeID];
    
    clockBg.src = "url(images/" + curTheme + ".png)";
    
    highlights.src = "images/" + clockHighlights[mySetting.themeID] + "_highlights.png";
    
    h.src = "images/" + curTheme + "_h.png";
    m.src = "images/" + curTheme + "_m.png";
    s.src = "images/" + curTheme + "_s.png";
    dot.src = "images/" + curTheme + "_dot.png";
}
////////////////////////////////////////////////////////////////////////////////
//
// calculate current time
//
////////////////////////////////////////////////////////////////////////////////
function timePerInterval()
{
    if (mySetting.timeZoneIndex != -1 && getValidTimeZone(mySetting.timeZoneIndex) != -1)
    {
        date = new Date(System.Time.getLocalTime(zones.item(mySetting.timeZoneIndex)));
    }
    else
    {
        date = new Date(System.Time.getLocalTime(System.Time.currentTimeZone));
    }
    
    with (date)
    {
        hours = getHours();
        minutes = getMinutes();
        seconds = getSeconds();
    }
    
    var rotationHours = hours;

    if (hours > 12)
    {
        rotationHours = hours - 12;
    }
    
    if (loadAnimation)
    {
        stopPositionHours = (rotationHours * 30) + (minutes / 2);
        stopPositionMinutes = (minutes * 6) + (seconds / 10);

        h.Rotation = 0;
        m.Rotation = 0;

        loadTimeMinutes(0);
        loadTimeHours(0);

        if (mySetting.secondsEnabled)
        {
            s.Rotation = 0;
            loadTimeSeconds(0);
        }
        
        loadAnimation = false;

        newTimeOut = setTimeout("timePerInterval(" + intervalTime + ")", (intervalTime * 2));
    }
    else
    {
        h.Rotation = (rotationHours * 30) + (minutes / 2);
        m.Rotation = (minutes * 6) + (seconds / 10);
        
        if (mySetting.secondsEnabled)
        {
            s.Rotation = (seconds * 6) + bounceDistance;

            setTimeout("bounceBack()", 50);
            
            var secondOffset = secondTimeOffset();
            
            if (secondOffset > 0)
            {
                newTimeOut = setTimeout("timePerInterval()", secondOffset);
            }
            else
            {
                timePerInterval();
            }
        }
        else
        {
            newTimeOut = setTimeout("timePerInterval()", 5000);
        }
    }
    updateDigitalTime();
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function visibilityChanged()
{
    if (System.Gadget.visible)
    {
        if (!newTimeOut)
        {
            loadAnimation = false;
            timePerInterval();
        }
    }
    else
    {
        clearTimeout(newTimeOut);
        newTimeOut = null;
    }
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function updateDigitalTime()
{
    digitalReadout.innerText = date.toLocaleTimeString();	
}
////////////////////////////////////////////////////////////////////////////////
//
// settings event closed
//
////////////////////////////////////////////////////////////////////////////////
function settingsClosed(event)
{
    if (event.closeAction == event.Action.commit)
    {
        settingsChanged();
    }
}
////////////////////////////////////////////////////////////////////////////////
// 
// set clock to the new settings
//
////////////////////////////////////////////////////////////////////////////////
function settingsChanged()
{
    mySetting.load();

    if (mySetting.timeZoneIndex != -1 && zonesCount == 0)
    {
        updateTimeZones();
    }

    var topPX = 0;
    var leftPX = 0;

    clockFont = "Segoe UI, Tahoma, Sans-Serif";
    clockFontColor = "#000000";
    clockFontSize = 10;
    
    var curTheme = clockThemes[getValidThemeID(mySetting.themeID)];
    
    switch (curTheme)
    {
        case "trad":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#2F2E2E";
            topPX += -3;
            leftPX += -1;
            maxClockNameWidth = 66;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 57;
	    sizeLogo = 71;
	    posLogo = (130/2) - (sizeLogo/2);
            break;
        case "system":
            clockFont = "Arial Narrow, " + clockFont;
            clockFontColor = "#666666";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
	    sizeLogo = 73;
	    posLogo = (130/2) - (sizeLogo/2);
	    break;
        case "modern":
            clockFont = "Arial Narrow, " + clockFont;
            clockFontColor = "#FFFFFF";
            topPX += 3;
            maxClockNameWidth = 74;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 58;
	    sizeLogo = 76;
	    posLogo = (130/2) - (sizeLogo/2);
            break;
        case "square":
            clockFont = "Calibri, " + clockFont;
            clockFontColor = "#000000";
            clockFontSize = 9;
            maxClockNameWidth = 70;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 57;
	    sizeLogo = 106;
	    posLogo = 12;
            break;
    }
        
    dot.style.width = h.style.width = m.style.width = s.style.width = clockPartsWidth;
    dot.style.height = h.style.height = m.style.height = s.style.height = clockPartsHeight;
    dot.style.top = h.style.top = m.style.top = s.style.top = clockPartsTop;
    dot.style.left = h.style.left = m.style.left = s.style.left = clockPartsLeft;
    
    setImages();

    with (digitalReadoutPosition.style)
    {
        top = posDigitalReadoutTop + topPX + "px";
        left = leftPX + "px";
        top = parseInt(top) + midClockNameFontHeight - Math.floor(clockName.offsetHeight / 2) + "px";
        visibility = "visible";
    }

    with (digitalReadout.style)
    {
        width = maxClockNameWidth + "px";
        fontFamily = clockFont;
        color = clockFontColor;
        fontSize = clockFontSize + "pt";
    }

    with (clockNamePosition.style)
    {
        top = posClockNameTop + topPX + "px";
        left = leftPX + "px";
        visibility = "hidden";
    }
 
    if (mySetting.clockName.length > 0)
    {
        with (clockName.style)
        {
            width = maxClockNameWidth + "px";
            fontFamily = clockFont;
            color = clockFontColor;
            fontSize = clockFontSize + "pt";
        }
        
        with (clockNamePosition.style)
        {
            top = parseInt(top) + midClockNameFontHeight - Math.floor(clockName.offsetHeight / 2) + "px";
            visibility = "visible";
        }

        clockName.innerText = mySetting.clockName;
    }

    loadAnimation = true;
    clearTimeout(newTimeOut);

    if (mySetting.secondsEnabled)
    {
        s.style.visibility = "visible";   
        dot.style.visibility = "hidden"; 
    }
    else
    {
        s.style.visibility = "hidden";
        dot.style.visibility = "visible";
    }

    if (mySetting.digitalEnabled)
    {
        digitalReadout.style.visibility = "visible";
    }
    else
    {
        digitalReadout.style.visibility = "hidden";
    }

    with (imglogo.style)
    {
        top = posLogo + "px";
        left = 1 + posLogo + "px";
	width = sizeLogo + "px";
	height = sizeLogo + "px";
   	if (trim(mySetting.logoFile, "both") == "")
   	{
   	    visibility = "hidden";
   	}
   	else
   	{
   	    visibility = "visible";
   	}    
    }	
    imglogo.src = mySetting.logoFile;
    
    timePerInterval();
}
////////////////////////////////////////////////////////////////////////////////
//
// makes second hand bounce
//
////////////////////////////////////////////////////////////////////////////////
function bounceBack()
{
    s.Rotation = s.Rotation - bounceDistance;
}
////////////////////////////////////////////////////////////////////////////////
//
//
////////////////////////////////////////////////////////////////////////////////
function secondTimeOffset()
{
    return 1000 - (new Date().getTime() % 1000);
}
////////////////////////////////////////////////////////////////////////////////
//
// animates rotation of minutes hand on load
//
////////////////////////////////////////////////////////////////////////////////
function loadTimeSeconds(currentPositionSeconds)
{
    var distanceSeconds = (seconds * 6 ) - currentPositionSeconds;

    if (currentPositionSeconds < ((seconds * 6) - 2))
    {
        newPositionSeconds = currentPositionSeconds + (distanceSeconds / 10);
        s.Rotation = newPositionSeconds;

        setTimeout("loadTimeSeconds(" + newPositionSeconds + ")", 20);
    }
    else
    {
        loadAnimation = false;
        s.Rotation = seconds * 6;
    }
}
////////////////////////////////////////////////////////////////////////////////
//
// animates rotation of minutes hand on load
//
////////////////////////////////////////////////////////////////////////////////
function loadTimeMinutes(currentPositionMinutes)
{
    var distanceMinutes = stopPositionMinutes - currentPositionMinutes;
    
    if (currentPositionMinutes < (stopPositionMinutes - 1))
    {
        newPositionMinutes = currentPositionMinutes + (distanceMinutes / 10);
        m.Rotation = newPositionMinutes;

        setTimeout("loadTimeMinutes(" +newPositionMinutes + ")", 20);
    }
    else
    {
        loadAnimation = false;
        m.Rotation = stopPositionMinutes;
    }
} 
////////////////////////////////////////////////////////////////////////////////
//
// animates rotation of hours hand on load
//
////////////////////////////////////////////////////////////////////////////////
function loadTimeHours(currentPositionHours)
{
    var distanceHours = stopPositionHours - currentPositionHours;

    if (currentPositionHours < (stopPositionHours - 1))
    {
        newPositionHours = currentPositionHours + (distanceHours / 10);
        h.Rotation = newPositionHours;

        setTimeout("loadTimeHours(" + newPositionHours + ")", 20);
    }
    else
    {
        loadAnimation = false;
        h.Rotation = stopPositionHours;
    }
}

