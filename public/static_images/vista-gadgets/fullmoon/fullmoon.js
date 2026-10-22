var	gTodaysMoon, gTodaysPhase;
var gCycleDays = 29.530589;
var gSecondsPerDay = 24 * 60 * 60;
var gMillisecondsPerDay = gSecondsPerDay * 1000;
var gMillisecondsPerYear = gMillisecondsPerDay * 365.25;
var gMillisecondsPerDayRecip = 1 / gMillisecondsPerDay;
var gMillisecondsPerYearRecip = 1 / gMillisecondsPerYear;
var gCycleMilliseconds = gCycleDays * gMillisecondsPerDay;
var	gNewMoonDate = Date.UTC(2008, 3 - 1, 7, 17, 14);
var gRiseTime, gSetTime;
var	gFirstDayOfWeek = 0; // Sunday
var	gFont = "Arial Black";
var	gMonthFont = "Arial";
var	gSouthernHemisphere = false;
var	gShowPhaseHighlights = true;
var	gClockBackground, gClockHourHand;
var	gClockLongitude = Number(System.Gadget.Settings.read("longitude"));
var	gClockBackgroundOpacity = 25;
var	gClockHandOpacity = 85;
var	gClockHandGlowFactor = 0.35;
var	gClockHandGlow2Factor = 0.8;
var	gClockTextOpacity = 85;
var	gClockTextGlowFactor = gClockHandGlowFactor;
var	gClockTextGlow2Factor = gClockHandGlow2Factor;
var	gLSTHour = 0;
var	gLSTMinute = 0;
var	gTextColorRGB = "232, 255, 224";
var	gTextColor = "Color(255, " + gTextColorRGB + ")";
var	gTextColor2RGB = "255, 207, 178";
var	gTextColor2 = "Color(255, " + gTextColor2RGB + ")";
var	gMouseIsOver = false;
var gShowSkymap = false;

var	gHourlyTooltip = new Array
(
	"", // 0h
	"Andromeda", // 1h
	"",
	"",
"Pleides", // 4h
	"",
	"",
"Orion", // 6h
	"Sirius", // 7h
	"Gemini", // 8h
	"",
	"Leo", // 10h
	"",
"Virgo clusters", // 12h
	"",
	"Arcturus", // 14h
	"",
	"",
	"Hercules", // 17h
"Milky Way Center", // 18h
	"Saggitarius", // 19h
	"Altair", // 20h
	"Cygnus", // 21h
	"",
	""
);

System.Gadget.settingsUI = "Settings.html";

function FullMoon_SettingsChanged(pEvent)
{
    if (pEvent.closeAction != pEvent.Action.commit)
		return;
	
	gClockLongitude = Number(System.Gadget.Settings.read("longitude"));

	FullMoon_BuildImage();
}

var gSidebarWidth;
var gSidebarHeight;
var gSidebarImageSize;
var gSidebarImageX;
var gSidebarImageY;
var gSidebarImageX2;
var gSidebarImageY2;

function FullMoon_BuildImage()
{
	var	vLargeSize = System.Gadget.Settings.read("large") == "true";
	var	vSouthernHemisphere = System.Gadget.Settings.read("south") == "true";
	var	vShowClock = System.Gadget.Settings.read("showclock") == "true";
	var vShowOnHover = System.Gadget.Settings.read("showonhover") == "true";
	
	gShowSkymap = System.Gadget.Settings.read("showskymap") == "true";
	
	if (!gMouseIsOver)
	{
		if (vShowOnHover)
			vShowClock = false;
		
		gShowSkymap = false;
	}
	
	if (vLargeSize)
	{
		gSidebarWidth = 130;
		gSidebarHeight = 130;
		gSidebarImageSize = gSidebarHeight;
		gSidebarImageX2 = 0;
		gSidebarImageY2 = 0;
		gSidebarImageX = gSidebarImageX2 + 17;
		gSidebarImageY = gSidebarImageY2 + 17;
	}
	else
	{
		gSidebarWidth = 130;
		gSidebarHeight = 100;
		gSidebarImageSize = gSidebarHeight;
		gSidebarImageX = Math.floor(0.5 * (gSidebarWidth - gSidebarImageSize) + 0.5);
		gSidebarImageY = Math.floor(0.5 * (gSidebarHeight - gSidebarImageSize) + 0.5);
		gSidebarImageX2 = gSidebarImageX - 15;
		gSidebarImageY2 = gSidebarImageY - 15;
	}
	
	document.body.style.height = gSidebarHeight + "px";
	
	background.removeObjects();
	
	gTodaysMoon = background.addImageObject("FullMoon.png", gSidebarImageX2, gSidebarImageY2);
	gTodaysMoon.width = gSidebarImageSize;
	gTodaysMoon.height = gSidebarImageSize;
	gTodaysMoon.rotation = vSouthernHemisphere? 180 : 0;
	
	gTodaysPhase = background.addImageObject("Phase14Mask.png", gSidebarImageX2, gSidebarImageY2);
	gTodaysPhase.width = gSidebarImageSize;
	gTodaysPhase.height = gSidebarImageSize;
	gTodaysPhase.rotation = vSouthernHemisphere? 180 : 0;
	
	if (gShowSkymap)
	{
		var	vMap = background.addImageObject("SiderealMap.png", gSidebarImageX2, gSidebarImageY2);
		vMap.width = gSidebarImageSize;
		vMap.height = gSidebarImageSize;
	}
	/*
	gClockBackground = background.addImageObject("ClockBackground.png", gSidebarImageX, gSidebarImageY);
	gClockBackground.width = gSidebarImageSize;
	gClockBackground.height = gSidebarImageSize;
	gClockBackground.opacity = gClockBackgroundOpacity;
	*/
	gClockHourHand = background.addImageObject("HourHand.png", gSidebarImageX, gSidebarImageY);
	gClockHourHand.width = gSidebarImageSize;
	gClockHourHand.height = gSidebarImageSize;
	gClockHourHand.opacity = gClockHandOpacity;
	gClockHourHand.addGlow(gShowSkymap? gTextColor2 : gTextColor, 3, gClockHandOpacity * (gShowSkymap? gClockHandGlow2Factor : gClockHandGlowFactor));
	
	gClockDigitalTime = FullMoon_AddCenteredText((" " + gLSTHour).slice(-2) + ":" + String("0" + gLSTMinute).slice(-2), gSidebarHeight - 44, null, gClockTextOpacity);
	
	if (!vShowClock)
	{
		// gClockBackground.opacity = 0;
		gClockHourHand.opacity = 0;
		gClockHourHand.addGlow("Color(255, 0, 0, 0)", 3, 0);
		gClockDigitalTime.opacity = 0;
	}
	
	//
	
	FullMoon_UpdatePhases();
	Clock_Update();
}

function FullMoon_OnLoad()
{
	System.Gadget.onSettingsClosed = FullMoon_SettingsChanged;
	
	FullMoon_BuildImage();
	setInterval("FullMoon_UpdatePhases()", 15 * 60 * 1000);
	setInterval("Clock_Update()", 5 * 1000);
}

function FullMoon_AddMoon()
{
	var	vMoon;
	
	vMoon = background.addImageObject("FullMoon.png", 0, 0);
	
	vMoon.width = 20;
	vMoon.height = 20;
	
	return vMoon;
}

function FullMoon_AddPhaseMask()
{
	var	vMoon;
	
	vMoon = background.addImageObject("Phase0Mask.png", 0, 0);
	
	vMoon.width = 20;
	vMoon.height = 20;
	
	return vMoon;
}

function FullMoon_UpdatePhases()
{
	var	vCycle = FullMoon_GetDateCycle(new Date()).Cycle;
	var	vSouthernHemisphere = System.Gadget.Settings.read("south") == "true";
	
	FullMoon_SetPhaseMask(gTodaysPhase, vCycle, vSouthernHemisphere);
}

function FullMoon_SetPhaseMask(pPhaseMask, pPhase, pRotate180)
{
	var vPhaseAngle = pPhase * 2.0 * Math.PI;
	var	vCosPhaseAngle = Math.cos(vPhaseAngle);
	
	if (pPhase >= 0.5)
		vCosPhaseAngle = -2.0 - vCosPhaseAngle;
	
	vCosPhaseAngle = (1.0 - vCosPhaseAngle) * 0.25;
	
	var vCycleIndex = Math.floor(vCosPhaseAngle * 64 + 0.5);
	
	if (vCycleIndex == 64)
		vCycleIndex = 0;
	
	if (vCycleIndex <= 32)
	{
		pPhaseMask.src = "Phase" + vCycleIndex + "Mask.png";
		pPhaseMask.rotation = pRotate180? 180 : 0;
	}
	else
	{
		pPhaseMask.src = "Phase" + (64 - vCycleIndex) + "Mask.png";
		pPhaseMask.rotation = pRotate180? 0 : 180;
	}
}

function FullMoon_ShowCalendar()
{
	if (System.Gadget.Flyout.show)
		System.Gadget.Flyout.show = false;
	else
	{
		System.Gadget.Flyout.file = "Calendar.html";
		System.Gadget.Flyout.show = true;
	}
}

function FullMoon_GetJulianDay(pDate)
{
	var vUTCYear = pDate.getUTCFullYear();
	var vUTCMonth = pDate.getUTCMonth();
	var vUTCDate = pDate.getUTCDate();
	
	if (vUTCMonth < 3)
	{
		vUTCMonth += 12;
		--vUTCYear;
	}
	
	var vA = Math.floor(vUTCYear / 100);
	var vB = 2 - vA + Math.floor(vA / 4);
	
	return Math.floor(365.25 * (vUTCYear + 4716)) + Math.floor(30.6001 * (vUTCMonth + 1)) + vUTCDate + vB - 1524.5;
}

function FullMoon_GetDateFromJulianDay(pJD)
{
	var vJD = pJD + 0.5;
	var vJDInt = Math.floor(vJD);
	var vJDFrac = vJD - vJDInt;
	
	var vA;
	
	if (vJDInt < 2299161)
		vA = vJDInt;
	
	if (vJDInt >= 2291161)
	{
		var vAlpha = Math.floor((vJDInt - 1867216.25) / 36524.25);
		vA = vJDInt + 1 + vAlpha - Math.floor(vAlpha / 4);
	}
	
	var vB = vA + 1524;
	var vC = Math.floor((vB - 122.1) / 365.25);
	var vD = Math.floor(365.25 * vC);
	var vE = Math.floor((vB - vD) / 30.6001);
	
	var vDay = vB - vD - Math.floor(30.6001 * vE);
	var vMonth = vE < 14? vE - 1 : vE - 13;
	var vYear = vMonth <= 2? (vC - 4715) : (vC - 4716)
	var vSecond = Math.floor(vJDFrac * gSecondsPerDay + 0.5);
	var vMinute = Math.floor(vSecond / 60);
	var vHour = Math.floor(vMinute / 60);
	
	vSecond -= vMinute * 60;
	vMinute -= vHour * 60;
	
	return new Date(Date.UTC(vYear, vMonth - 1, vDay, vHour, vMinute, vSecond));
}

function FullMoon_GetJulianDate(pDate)
{
	var vUTCYear = pDate.getUTCFullYear();
	var vUTCMonth = pDate.getUTCMonth();
	var vUTCDate = pDate.getUTCDate();
	
	return Date.UTC(vUTCYear, vUTCMonth, vUTCDate, 0, 0, 0)
	       * gMillisecondsPerDayRecip
	       + 25567.5;
}

var g2000InMilliseconds = Date.UTC(2000, 0, 1, 0, 0, 0, 0);

function FullMoon_GetDateApproxPhase(pDate)
{
	return (pDate.valueOf() - g2000InMilliseconds) * gMillisecondsPerYearRecip * 12.3685;
}

var gFullPhaseCoeffs = Array
(
	//       Coeff  E  E2 M'  M   F Ohm
	Array(-0.40614, 0, 0, 1,  0,  0, 0),
	Array( 0.17302, 1, 0, 0,  1,  0, 0),
	Array( 0.01614, 0, 0, 2,  0,  0, 0),
	Array( 0.01043, 0, 0, 0,  0,  2, 0),
	Array( 0.00734, 1, 0, 1, -1,  0, 0),
	Array(-0.00515, 1, 0, 1,  1,  0, 0),
	Array( 0.00209, 0, 1, 0,  2,  0, 0),
	Array(-0.00111, 0, 0, 1,  0, -2, 0),
	Array(-0.00057, 0, 0, 1,  0,  2, 0),
	Array( 0.00056, 1, 0, 2,  1,  0, 0),
	Array(-0.00042, 0, 0, 3,  0,  0, 0),
	Array( 0.00042, 1, 0, 0,  1,  2, 0),
	Array( 0.00038, 1, 0, 0,  1, -2, 0),
	Array(-0.00024, 1, 0, 2, -1,  0, 0),
	Array(-0.00017, 0, 0, 0,  0,  0, 1),
	Array(-0.00007, 0, 0, 1,  2,  0, 0),
	Array( 0.00004, 0, 0, 2,  0, -2, 0),
	Array( 0.00004, 0, 0, 0,  3,  0, 0),
	Array( 0.00003, 0, 0, 1,  1, -2, 0),
	Array( 0.00003, 0, 0, 2,  0,  2, 0),
	Array(-0.00003, 0, 0, 1,  1,  2, 0),
	Array( 0.00003, 0, 0, 1, -1,  2, 0),
	Array(-0.00002, 0, 0, 1, -1, -2, 0),
	Array(-0.00002, 0, 0, 3,  1,  0, 0),
	Array( 0.00002, 0, 0, 4,  0,  0, 0)
);

var gNewPhaseCoeffs = Array
(
	//       Coeff  E  E2 M'  M   F Ohm
	Array(-0.40720, 0, 0, 1,  0,  0, 0),
	Array( 0.17241, 1, 0, 0,  1,  0, 0),
	Array( 0.01608, 0, 0, 2,  0,  0, 0),
	Array( 0.01039, 0, 0, 0,  0,  2, 0),
	Array( 0.00739, 1, 0, 1, -1,  0, 0),
	Array(-0.00514, 1, 0, 1,  1,  0, 0),
	Array( 0.00208, 0, 1, 0,  2,  0, 0),
	Array(-0.00111, 0, 0, 1,  0, -2, 0),
	Array(-0.00057, 0, 0, 1,  0,  2, 0),
	Array( 0.00056, 1, 0, 2,  1,  0, 0),
	Array(-0.00042, 0, 0, 3,  0,  0, 0),
	Array( 0.00042, 1, 0, 0,  1,  2, 0),
	Array( 0.00038, 1, 0, 0,  1, -2, 0),
	Array(-0.00024, 1, 0, 2, -1,  0, 0),
	Array(-0.00017, 0, 0, 0,  0,  0, 1),
	Array(-0.00007, 0, 0, 1,  2,  0, 0),
	Array( 0.00004, 0, 0, 2,  0, -2, 0),
	Array( 0.00004, 0, 0, 0,  3,  0, 0),
	Array( 0.00003, 0, 0, 1,  1, -2, 0),
	Array( 0.00003, 0, 0, 2,  0,  2, 0),
	Array(-0.00003, 0, 0, 1,  1,  2, 0),
	Array( 0.00003, 0, 0, 1, -1,  2, 0),
	Array(-0.00002, 0, 0, 1, -1, -2, 0),
	Array(-0.00002, 0, 0, 3,  1,  0, 0),
	Array( 0.00002, 0, 0, 4,  0,  0, 0)
);

var gQuarterPhaseCoeffs = Array
(
	Array(-0.62801, 0, 0,  1,  0,  0,  0),
	Array( 0.17172, 1, 0,  0,  1,  0,  0),
	Array(-0.01183, 1, 0,  1,  1,  0,  0),
	Array( 0.00862, 0, 0,  2,  0,  0,  0),
	Array( 0.00804, 0, 0,  0,  0,  2,  0),
	Array( 0.00454, 1, 0,  1, -1,  0,  0),
	Array( 0.00204, 0, 1,  0,  2,  0,  0),
	Array(-0.00180, 0, 0,  1,  0, -2,  0),
	Array(-0.00070, 0, 0,  1,  0,  2,  0),
	Array(-0.00040, 0, 0,  3,  0,  0,  0),
	Array(-0.00034, 1, 0,  2, -1,  0,  0),
	Array( 0.00032, 1, 0,  0,  1,  2,  0),
	Array( 0.00032, 1, 0,  0,  1, -2,  0),
	Array(-0.00028, 0, 1,  1,  2,  0,  0),
	Array( 0.00027, 1, 0,  2,  1,  0,  0),
	Array(-0.00017, 0, 0,  0,  0,  0,  1),
	Array(-0.00005, 0, 0,  1, -1, -2,  0),
	Array( 0.00004, 0, 0,  2,  0,  2,  0),
	Array(-0.00004, 0, 0,  1,  1,  2,  0),
	Array( 0.00004, 0, 0,  1, -2,  0,  0),
	Array( 0.00003, 0, 0,  1,  1, -2,  0),
	Array( 0.00003, 0, 0,  0,  3,  0,  0),
	Array( 0.00002, 0, 0,  2,  0, -2,  0),
	Array( 0.00002, 0, 0,  1, -1,  2,  0),
	Array(-0.00002, 0, 0,  3,  1,  0,  0)
);

var gPhaseCoeffs = Array
(
	gNewPhaseCoeffs,
	gQuarterPhaseCoeffs,
	gFullPhaseCoeffs,
	gQuarterPhaseCoeffs
);

var gPlanetaryArguments = Array
(
	Array(299.77, 0.107408),
	Array(251.88, 0.016321),
	Array(251.83, 26.651886),
	Array(349.42, 36.412478),
	Array(84.66, 18.206239),
	Array(141.74, 53.303771),
	Array(207.14, 2.453732),
	Array(154.84, 7.306860),
	Array(34.52, 27.261239),
	Array(207.19, 0.121824),
	Array(291.34, 1.844379),
	Array(161.72, 24.198153),
	Array(239.56, 25.513099),
	Array(331.55, 3.592518)
);

var gPlanetaryArgument0T2 = -0.009173;

var gPlanetaryArgFactors = Array
(
	0.000325,
	0.000165,
	0.000164,
	0.000126,
	0.000110,
	0.000062,
	0.000060,
	0.000056,
	0.000047,
	0.000042,
	0.000040,
	0.000037,
	0.000035,
	0.000023
);

var gPhaseDateCache = Array();

function FullMoon_GetPhaseJulianDay(pPhase)
{
	if (gPhaseDateCache[pPhase])
		return gPhaseDateCache[pPhase];
	
	var vCenturies = pPhase / 1236.85;
	var vCenturies2 = vCenturies * vCenturies;
	var vCenturies3 = vCenturies2 * vCenturies;
	var vCenturies4 = vCenturies2 * vCenturies2;
	
	var vBaseDate = 2451550.09766 + 29.530588861 * pPhase
	                              +  0.00015437 * vCenturies2
	                              -  0.000000150 * vCenturies3
	                              +  0.00000000073 * vCenturies4;
	
	var vEccentricity = 1 - 0.002516 * vCenturies - 0.0000074 * vCenturies * vCenturies;
	var vEccentricity2 = vEccentricity * vEccentricity;
	
	var vAngleArgs = new Array
	(
		// Moon mean anomaly
		
		(201.5643 + 385.81693528 * pPhase
		         + 0.0107582 * vCenturies2
		         + 0.00001238 * vCenturies3
		         - 0.000000058 * vCenturies4) * Math.PI / 180.0,
		
		// Sun mean anomaly
		
		(2.5534 + 29.10535670 * pPhase
                 - 0.0000014 * vCenturies2
                 - 0.00000011 * vCenturies3)  * Math.PI / 180.0,
		
		// Moon arg of latitude
		
		(160.7108 + 390.67050284 * pPhase
		         - 0.0016118 * vCenturies2
		         - 0.00000227 * vCenturies3
		         + 0.000000011 * vCenturies4)  * Math.PI / 180.0,
		
		// Ascending node
		
		(124.7746 - 1.56375588 * pPhase
		         + 0.0020672 * vCenturies2
		         + 0.00000215 * vCenturies3)  * Math.PI / 180.0
	);
	
	var vQuarterIndex = Math.floor(pPhase * 4 + 0.5) % 4;
	
	if (vQuarterIndex < 0)
		vQuarterIndex += 4;
	
	var vPhaseCoeffs = gPhaseCoeffs[vQuarterIndex];
	var vValue = 0;
	
	for (var vIndex = 0; vIndex < vPhaseCoeffs.length; ++vIndex)
	{
		var vRowCoeffs = vPhaseCoeffs[vIndex];
		var vRowValue = vRowCoeffs[0];
		
		if (vRowCoeffs[1])
			vRowValue *= vRowCoeffs[1] * vEccentricity;
		
		if (vRowCoeffs[2])
			vRowValue *= vRowCoeffs[2] * vEccentricity2;
		
		var vAngle = 0;
		
		for (var vIndex2 = 0; vIndex2 < 4; ++vIndex2)
		{
			var vCoeff = vRowCoeffs[vIndex2 + 3];
			
			if (vCoeff)
				vAngle += vCoeff * vAngleArgs[vIndex2];
		}
		
		var vSinAngle = Math.sin(vAngle);
		
		vRowValue *= vSinAngle;
		
		vValue += vRowValue;
	}
	
	var vAdjustedDate = vBaseDate + vValue;
	
	//
	
	var vPlanetaryArgs = Array();
	var vPlanetaryOffset = 0;
	
	for (var vIndex = 0; vIndex < gPlanetaryArguments.length; ++vIndex)
	{
		var vArgRow = gPlanetaryArguments[vIndex];
		var vArg = vArgRow[0] + vArgRow[1] * pPhase;
		
		if (vIndex == 0)
			vArg += gPlanetaryArgument0T2 * vCenturies2;
		
		vPlanetaryOffset += gPlanetaryArgFactors[vIndex] * Math.sin(vArg * Math.PI / 180.0);
	}
	
	var vPlanetAdjustedDate = vAdjustedDate + vPlanetaryOffset;
	
	//
	
	var vQuarterCorrection = 0;
	
	if (vQuarterIndex == 1 || vQuarterIndex == 3)
	{
		vQuarterCorrection = 0.00306
		                   - 0.00038 * vEccentricity * Math.cos(vAngleArgs[1])
		                   + 0.00026 * Math.cos(vAngleArgs[0])
		                   - 0.00002 * Math.cos(vAngleArgs[0]- vAngleArgs[1])
		                   + 0.00002 * Math.cos(vAngleArgs[0] + vAngleArgs[1])
		                   + 0.00002 * Math.cos(2 * vAngleArgs[2]);
		
		if (vQuarterIndex == 3)
			vQuarterCorrection = -vQuarterCorrection;
	}
	
	var vFinalDate = vPlanetAdjustedDate + vQuarterCorrection;
	
	//
	
	gPhaseDateCache[pPhase] = vFinalDate;
	
	return vFinalDate;
}

function FullMoon_GetPhaseDate(pPhase)
{
	return FullMoon_GetDateFromJulianDay(FullMoon_GetPhaseJulianDay(pPhase));
}

/*
function FullMoon_GetDateCycle(pDate)
{
	var vDateValue = pDate.valueOf();
	var vNewMoonOffset = vDateValue - gNewMoonDate;
	var vCycleOffset = vNewMoonOffset % gCycleMilliseconds;
	var	vCycle = vCycleOffset / gCycleMilliseconds;
	
	if (vCycle < 0)
		vCycle += 1;
	
	return vCycle;
}
*/
function FullMoon_GetDateCycle(pDate)
{
	var vJulianDay = FullMoon_GetJulianDay(pDate);
	var vPhase0 = (pDate.valueOf() - g2000InMilliseconds) * gMillisecondsPerYearRecip * 12.3685;
	
	vPhase0 = Math.floor(vPhase0 * 4) / 4;
	
	var vPhase0Date = FullMoon_GetPhaseDate(vPhase0);
	
	while (vPhase0Date > pDate)
	{
		vPhase0 -= 0.25;
		vPhase0Date = FullMoon_GetPhaseDate(vPhase0);
	}
	
	var vPhase1Date = FullMoon_GetPhaseDate(vPhase0 + 0.25);
	
	while (vPhase1Date < pDate)
	{
		vPhase0 += 0.25;
		vPhase0Date = vPhase1Date;
		vPhase1Date = FullMoon_GetPhaseDate(vPhase0 + 0.25);
	}
	
	var vCycle0 = vPhase0 - Math.floor(vPhase0);
	var vCycleInfo = new Object();
	
	vCycleInfo.Cycle = vCycle0 + ((pDate.valueOf() - vPhase0Date.valueOf()) / (vPhase1Date.valueOf() - vPhase0Date.valueOf())) * 0.25;
	vCycleInfo.PhaseChanges = vPhase1Date.valueOf() - pDate.valueOf() < gMillisecondsPerDay;
	
	return vCycleInfo;
}

function FullMoon_AddCenteredText(pText, pY, pColor, pOpacity)
{
	var	vText;
	
	vText = background.addTextObject(pText, gFont, 14, "Color(255, 0, 0, 0)", 0, pY);
	vText.addGlow(gShowSkymap? gTextColor2 : gTextColor, 3, pOpacity * (gShowSkymap? gClockTextGlow2Factor : gClockTextGlowFactor));
	vText.left = 0.5 * (130 - vText.width);
	vText.opacity = pOpacity;
	
	return vText;
}

function FullMoon_OnMouseOver()
{
	gMouseIsOver = true;
	
	var vShowClock = System.Gadget.Settings.read("showclock") == "true";
	var vShowOnHover = System.Gadget.Settings.read("showonhover") == "true";
	var vShowSkymap = System.Gadget.Settings.read("showskymap") == "true";
	
	if (vShowClock && (vShowOnHover || vShowSkymap))
		FullMoon_BuildImage();
	
/*
	var	vTextY = 0;
	var	vLineSpacing = 15;
	
	FullMoon_AddCenteredText("Now Overhead", vTextY, null, 100);
	vTextY += vLineSpacing + 3;
	
	for (vHourOffset = 2; vHourOffset >= -3; --vHourOffset)
	{
		var vHour = gLSTHour + vHourOffset;
		
		if (vHour < 0)
			vHour += 24;
		else if (vHour >= 24)
			vHour -= 24;
		
		var	vMessage = gHourlyTooltip[vHour];
		
		if (vMessage != "")
		{
			FullMoon_AddCenteredText(vMessage, vTextY, null, 100);
			vTextY += vLineSpacing;
		}
	}
*/
}

function FullMoon_OnMouseOut()
{
	gMouseIsOver = false;
	
	var vShowClock = System.Gadget.Settings.read("showclock") == "true";
	var vShowOnHover = System.Gadget.Settings.read("showonhover") == "true";
	var vShowSkymap = System.Gadget.Settings.read("showskymap") == "true";
	
	if (vShowClock && (vShowOnHover || vShowSkymap))
		FullMoon_BuildImage();
}

//----------------------------------------
// Test
//----------------------------------------

function FullMoon_Test()
{
	var vDate;
	
	debugger;
	
	vDate = FullMoon_GetPhaseDate(0); // Should be January 6, 2000, 18:14 UT
	vDate = FullMoon_GetPhaseDate(0.25); // Should be January 14, 2000, 13:34 UT
	vDate = FullMoon_GetPhaseDate(0.5); // Should be January 21, 2000, 4:40 UT
	vDate = FullMoon_GetPhaseDate(0.75); // Should be January 28, 2000, 7:57 UT
	
	vDate = FullMoon_GetPhaseJulianDay(-283.0); // 2443192.94102 - 0.28916 - 0.00068 = 2443192.65118
	vDate = FullMoon_GetPhaseJulianDay(544.75); // 2467535.88597 - 0.39153 - 0.00251 - 0.00007 = 2467636.49186
}

//----------------------------------------
function Calendar(pBackground)
//----------------------------------------
{
	this.Background = pBackground;
	
	this.CellWidth = 28;
	this.CellHeight = 28;
	this.ImageWidth = 24;
	this.ImageHeight = 24;
	this.GridTop = 47;
	
	//----------------------------------------
	this.SetMonthView = function(pMonth, pYear)
	//----------------------------------------
	{
		var	vSouthernHemisphere = System.Gadget.Settings.read("south") == "true";
		var	vShowPhaseHighlights = System.Gadget.Settings.read("nohighlight") != "true";
		
		this.Background.removeObjects();
		
		var	vDisplayDate = new Date(pYear, pMonth, 1);
		var	vCurrentDate = new Date();
		
		//
		
		this.Background.addTextObject(GetLongMonthName(pMonth) + " " + pYear, gMonthFont, 18, "White", 10, 9);
		/*
		var	vPrevMonthButton = this.Background.addImageObject("LeftArrow.png", 160, 9);
		var	vNextMonthButton = this.Background.addImageObject("RightArrow.png", 180, 9);
		*/
		//
		
		var	vDate = new Date(pYear, pMonth, 1 - vDisplayDate.getDay() + gFirstDayOfWeek);
		var	vCycleIncr = 1.0 / gCycleDays;
		
		for (var vColumn = 0; vColumn < 7; ++vColumn)
		{
			var	vLeft = vColumn * this.CellWidth + 9;
			var	vText = this.Background.addTextObject(GetShortWeekdayName(vColumn + 1), gMonthFont, 10, "White", 0, this.GridTop - 13);
			
			vText.left = vLeft + 0.5 * (this.CellWidth - vText.width);
		}
		
		// FullMoon_Test();
		
		for (var vRow = 0; vRow < 5; ++vRow)
		{
			var	vTop = vRow * this.CellHeight + 4 + this.GridTop;
			
			for (var vColumn = 0; vColumn < 7; ++vColumn)
			{
				var	vLeft = vColumn * this.CellWidth + 12;
				var	vCycleInfo = FullMoon_GetDateCycle(vDate);
				
				var vImage = this.Background.addImageObject("FullMoon.png", vLeft - 53, vTop - 51);
				
				if (vSouthernHemisphere)
					vImage.rotation = 180;
				
				vImage.width = this.ImageWidth;
				vImage.height = this.ImageHeight;
				
				var	vMask = this.Background.addImageObject("Phase0Mask.png", vLeft - 53, vTop - 51);

				vMask.width = this.ImageWidth;
				vMask.height = this.ImageHeight;
				
				FullMoon_SetPhaseMask(vMask, vCycleInfo.Cycle, vSouthernHemisphere);
				
				// Check for new moon
				
				if (vShowPhaseHighlights && vCycleInfo.PhaseChanges)
				{
					var	vHighlight = this.Background.addImageObject("HighlightRing.png", vLeft - 36, vTop - 34);
					
					vHighlight.width = this.ImageWidth;
					vHighlight.height = this.ImageHeight;
				}
				
				//
				
				var	vIsToday = vDate.getMonth() == vCurrentDate.getMonth() && vDate.getDate() == vCurrentDate.getDate() && vDate.getYear() == vCurrentDate.getYear();
				var vColor;
				
				if (vDate.getMonth() == pMonth)
					vColor = "White";
				else
				{
					vColor = "Color(255, 192, 192, 192)";
					vImage.opacity = 50;
					vMask.opacity = 50;
				}
				
				var	vText;
				
				if (vIsToday)
				{
					vText = this.Background.addTextObject(vDate.getDate(), gFont, 10, vColor, vLeft, vTop);
					vText.addGlow("Color(255, 255, 148, 29)", 3, 100);
				}
				
				vText = this.Background.addTextObject(vDate.getDate(), gFont, 10, vColor, vLeft, vTop);
				vText.addGlow("Color(255, 0, 0, 0)", 1, 100);
				
				vDate.setDate(vDate.getDate() + 1);
			}
		}
	};

	//----------------------------------------
	this.NextMonth = function()
	//----------------------------------------
	{
		this.Date.setMonth(this.Date.getMonth() + 1);
		
		this.SetMonthView(this.Date.getMonth(), this.Date.getYear());
	}
	
	//----------------------------------------
	this.PreviousMonth = function()
	//----------------------------------------
	{
		this.Date.setMonth(this.Date.getMonth() - 1);
		
		this.SetMonthView(this.Date.getMonth(), this.Date.getYear());
	}
	
	//
	
	this.Date = new Date();
	this.SetMonthView(this.Date.getMonth(), this.Date.getYear());
}

//----------------------------------------
//----------------------------------------

function MoonCalendar_Initialize(pCalendarDIV)
{
	gCalendar = new Calendar(pCalendarDIV);
}

function Settings_OnLoad()
{
	System.Gadget.onSettingsClosing = Settings_OnClose;
	
	Checkbox_South.checked = System.Gadget.Settings.read("south") == "true";
	Checkbox_Highlight.checked = System.Gadget.Settings.read("nohighlight") != "true";
	Checkbox_ShowClock.checked = System.Gadget.Settings.read("showclock") == "true";
	
	gClockLongitude = Number(System.Gadget.Settings.read("longitude"));
	Text_Longitude.value = gClockLongitude;
	Checkbox_ShowOnHover.checked = System.Gadget.Settings.read("showonhover") == "true";
	Checkbox_ShowSkymap.checked = System.Gadget.Settings.read("showskymap") == "true";
	
	Checkbox_Large.checked = System.Gadget.Settings.read("large") == "true";
}

function Settings_OnClose(pEvent)
{
	if (pEvent.closeAction != pEvent.Action.commit)
		return;
	
	System.Gadget.Settings.write("south", Checkbox_South.checked? "true" : "false");
	System.Gadget.Settings.write("nohighlight", Checkbox_Highlight.checked? "false" : "true");
	System.Gadget.Settings.write("showclock", Checkbox_ShowClock.checked? "true" : "false");
	
	gClockLongitude = Number(Text_Longitude.value);
	System.Gadget.Settings.write("longitude", gClockLongitude);
	System.Gadget.Settings.write("showonhover", Checkbox_ShowOnHover.checked? "true" : "false");
	System.Gadget.Settings.write("showskymap", Checkbox_ShowSkymap.checked? "true" : "false");
	
	System.Gadget.Settings.write("large", Checkbox_Large.checked? "true" : "false");
}

function trunc(x) 
{
	if (x >= 0)
		return Math.floor(x);
	else
		return Math.ceil(x); 
}

function Clock_Update()
{
	if (gClockHourHand.opacity == 0)
		return;
	
	var	vCurrentDate = new Date();
	var vUTCHour = (((vCurrentDate.getUTCSeconds() / 60) + vCurrentDate.getUTCMinutes()) / 60) + vCurrentDate.getUTCHours();
	
	// Convert the date to Julian
	
	var vUTCYear = vCurrentDate.getUTCFullYear();
	var vUTCMonth = vCurrentDate.getUTCMonth();
	var vUTCDate = vCurrentDate.getUTCDate();
	
	var	vJulianDate = FullMoon_GetJulianDate(vCurrentDate)
	
	//
	
	var	T = (vJulianDate / 36525.0) - 1.0;
	var	R1 = 6.697374558 + (2400.0 * (T - ((vUTCYear - 2000) / 100)));
	var	R0 = (0.0513366 * T) + (0.00002586222 * T * T) - (0.000000001722 * T * T * T);
	var	t0 = R0 + R1;
	
	t0 /= 24.0;
	t0 -= Math.floor(t0);
	t0 *= 24.0;
	
	var	vLSTAngle = ((vUTCHour * 1.00273790935) + t0) * 15.0 + gClockLongitude;
	
	vLSTAngle /= 360.0;
	vLSTAngle -= Math.floor(vLSTAngle);
	vLSTAngle *= 360.0;
	
	gClockHourHand.rotation = vLSTAngle;
	
	//
	
	var	vLSTHourReal = vLSTAngle / 15.0;
	
	var	vLSTHour = Math.floor(vLSTHourReal);
	var	vLSTMinute = Math.floor((vLSTHourReal - vLSTHour) * 60.0);
	
	if (vLSTHour != gLSTHour || vLSTMinute != gLSTMinute)
	{
		gLSTHour = vLSTHour;
		gLSTMinute = vLSTMinute;
		
		FullMoon_BuildImage();
	}
}
