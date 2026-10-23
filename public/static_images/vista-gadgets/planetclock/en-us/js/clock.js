////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2008 Lorne L. Reap  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////
var clockThemes                = new Array("system", "earth", "mercury", "venus", "moon", "mars", "jupiter", "calisto", "ganymede", "io", "saturn", "uranus", "neptune",  "pluto");
var clockHighlights            = new Array("spacer", "mercury", "venus", "moon", "mars", "jupiter", "calisto", "ganymede", "io", "saturn", "uranus", "neptune",  "pluto");
var bounceDistance             = 3;
var newPositionMinutes         = 0;
var currentPositionMinutes     = 0;
var newPositionHours           = 0;
var currentPositionHours       = 0;
var midClockNameFontHeight     = 8;
var maxClockNameWidth          = 60;
var posClockNameTop
var posDateDisplayTop
var posDigitalReadoutTop
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
var currentMinute;
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

        newTimeOut = setTimeout("timePerInterval()", secondOffset);
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
            updateDigitalTime();
            updateDate();
        }
        else
        {
           if (mySetting.secondsEnabledDigital)
           {
               newTimeOut = setTimeout("timePerInterval()", 0);
           }
           else
           {
              newTimeOut = setTimeout("timePerInterval()", 5000);
           }
           
           updateDigitalTime();
           updateDate();
        }
    }
}
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
function updateDigitalTime()
{
    var currentHours = date.getHours();
    var currentMinutes = date.getMinutes();
    var currentSeconds = "";
    var AMPM = "";         

    currentMinutes = (currentMinutes < 10 ? "0" : "") + currentMinutes;    

    if (mySetting.secondsEnabledDigital)
    {
        currentSeconds = date.getSeconds();
        currentSeconds = (currentSeconds < 10 ? ":0" : ":") + currentSeconds;
    }

    if (mySetting.show24)
    {
        currentHours = (currentHours < 10 ? "0" : "") + currentHours;
    }
    else
    {
        AMPM = (currentHours < 12) ? " AM" : " PM";
        currentHours = (currentHours > 12) ? currentHours - 12 : currentHours;
        currentHours = (currentHours == 0) ? 12 : currentHours;
    }
    digitalReadout.innerText = currentHours + ":" + currentMinutes + currentSeconds + AMPM;
}
function updateDate()
{
    dateDisplay.innerText = date.getDate();	
}
function settingsClosed(event)
{
    if (event.closeAction == event.Action.commit)
    {
        settingsChanged();
    }
}
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
    clockFontSize = 12;
    
    var curTheme = clockThemes[getValidThemeID(mySetting.themeID)];
    
    switch (curTheme)
    {
        case "system":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#FCFD89";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            posClockNameTop = 28;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 80;
            dateBorderColor = "silver";
            break;
         case "earth":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#FCFD89";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            posClockNameTop = 28;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 80;
            dateBorderColor = "silver";
            break;
         case "mercury":   
         case "mercury":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#000000";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            posClockNameTop = 28;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 80;
            dateBorderColor = "red";
            break;   
         case "venus":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#000000";
            topPX += -3;
            leftPX += -1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 58;
            posClockNameTop = 28;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 80;
            dateBorderColor = "silver";
            break;
	  case "moon":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#2F2E2E";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            posClockNameTop = 34;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 76;
            dateBorderColor = "gray";
            break;    
	
        case "mars":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#2F2E2E";
            topPX += -3;
            leftPX += -1;
            maxClockNameWidth = 66;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 57;
            posClockNameTop = 40;
            posDateDisplayTop = 60;
            posDigitalReadoutTop = 78;
            dateBorderColor = "black";
            break;
        case "jupiter":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#2F2E2E";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            posClockNameTop = 34;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 76;
            dateBorderColor = "gray";
            break;
	  case "calisto":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#2F2E2E";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            posClockNameTop = 34;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 76;
            dateBorderColor = "gray";
            break; 
	 case "ganymede":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#2F2E2E";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            posClockNameTop = 34;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 76;
            dateBorderColor = "gray";
            break;        
       case "io":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#2F2E2E";
            topPX += 3;
            leftPX += 1;
            maxClockNameWidth = 72;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = 0;
            clockPartsLeft = 58;
            posClockNameTop = 34;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 76;
            dateBorderColor = "gray";
            break;        
        case "saturn":
		 clockFont = "Constantia, " + clockFont;
            clockFontColor = "#000000";
            topPX += -3;
            leftPX += -1;
            maxClockNameWidth = 66;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 57;
            posClockNameTop = 40;
            posDateDisplayTop = 60;
            posDigitalReadoutTop = 78;
            dateBorderColor = "white";
            break;
         case "uranus":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#000000";
            topPX += 3;
            maxClockNameWidth = 74;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 58;
            posClockNameTop = 32;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 76;
            dateBorderColor = "white";
            break;    
        case "neptune":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#000000";
            topPX += 3;
            maxClockNameWidth = 74;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 58;
            posClockNameTop = 32;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 76;
            dateBorderColor = "white";
            break;    
        case "pluto":
            clockFont = "Constantia, " + clockFont;
            clockFontColor = "#000000";
            topPX += 3;
            maxClockNameWidth = 74;
            clockPartsWidth = 13;
            clockPartsHeight = 129;
            clockPartsTop = -1;
            clockPartsLeft = 58;
            posClockNameTop = 32;
            posDateDisplayTop = 54;
            posDigitalReadoutTop = 76;
            dateBorderColor = "white";
            break;    

    }
    
    dot.style.width = h.style.width = m.style.width = s.style.width = clockPartsWidth;
    dot.style.height = h.style.height = m.style.height = s.style.height = clockPartsHeight;
    dot.style.top = h.style.top = m.style.top = s.style.top = clockPartsTop;
    dot.style.left = h.style.left = m.style.left = s.style.left = clockPartsLeft;
    
    setImages();

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

    with (dateDisplayPosition.style)
    {
        top = posDateDisplayTop + topPX + "px";
        left = "80px";
        border = "solid " + dateBorderColor + " 1px";
        visibility = "visible";
    }

    with (dateDisplay.style)
    {
        width = "15px";
        fontFamily = clockFont;
        color = clockFontColor;
        fontSize = clockFontSize - 1 + "pt";
    }

    with (digitalReadoutPosition.style)
    {
        top = posDigitalReadoutTop + topPX + "px";
        left = leftPX + "px";
        visibility = "visible";
    }

    with (digitalReadout.style)
    {
        width = maxClockNameWidth + "px";
        fontFamily = clockFont;
        color = clockFontColor;
        fontSize = clockFontSize + "pt";
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
    
    timePerInterval();
}
function bounceBack()
{
    s.Rotation = s.Rotation - bounceDistance;
}

function secondTimeOffset()
{
    return 1000 - (new Date().getTime() % 1000);
}
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
