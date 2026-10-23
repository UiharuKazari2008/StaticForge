//////////////////////////////////////////////////////////////////////////
// SFlyout.js                                                           //
// Rogério Tomio Hirooka - 2007.02.20 19:22                             //
// - Contém o código de apresentação dos relógios múltiplos.            //
//////////////////////////////////////////////////////////////////////////

//************************************************************************
// função Init_Multiclock
// - Retorna diversos formatos de horario e tempo, a partir do relógio
//   atual do sistema, e realimenta a função ao final da execução.
//************************************************************************

function Init_Multiclock() 
{
    if (!document.layers && !document.all) return;
    var hex         = new Array("0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F");
    var ticktock    = new Date();
    var month       = ticktock.getMonth()+1;
    var date        = ticktock.getDate();
    var day         = ticktock.getDay();
    var year        = ticktock.getFullYear();
    var utime       = ticktock.getTime();
    var hours       = ticktock.getHours();
    var minutes     = ticktock.getMinutes();
    var seconds     = ticktock.getSeconds();

    var GMTmonth    = ticktock.getUTCMonth()+1;
    var GMTdate     = ticktock.getUTCDate();
    var GMTday      = ticktock.getUTCDay();
    var GMTyear     = ticktock.getUTCFullYear();
    var GMThours    = ticktock.getUTCHours();
    var GMTminutes  = ticktock.getUTCMinutes();
    var GMTseconds  = ticktock.getUTCSeconds();

    var milliseconds = (utime*1000).toString().substring(10,13);
    var apm = "am";

    var Swatch = "@" + (((utime/86400000)%1)+(1/24)).toString().substring(2,5);

    var decimaltime     = ((hours/24)+(minutes/1440)+(seconds/86400)+(milliseconds/86400000));
    decimaltime         = decimaltime.toString().substring(1,7);
    var udect           = ((utime/86400000)%1).toString().substring(1,7);
    var totalseconds    = (hours * 3600 + minutes * 60 + seconds + milliseconds / 1000);
    var gotime          = utime/864 + 50000;
    var umt1            = gotime.toString().substring(5,7);
    var umt2            = gotime.toString().substring(7,10);

    with (Math) 
    {
        var hextime     = floor(totalseconds / 1.318359375);
        var hex1        = floor(hextime / 4096);
        hextime        -= 4096 * hex1;
        var hex2        = floor(hextime / 256);
        hextime        -= 256 * hex2;
        var hex3        = floor(hextime / 16);
        hextime        -= 16 * hex3;
        var hex4        = hextime;
    }

    var hexadecimalValue = hex[hex1] + "_"+ hex[hex2] + hex[hex3] + "_" + hex[hex4];

	// Dias da semana em inglês.
    if (day==0)
        day="Sun";
    if (day==1)
        day="Mon";
    if (day==2)
        day="Tue";
    if (day==3)
        day="Wed";
    if (day==4)
        day="Thu";
    if (day==5)
        day="Fri";
    if (day==6)
        day="Sat";

    if (GMTday==0)
        GMTday="Sun";
    if (GMTday==1)
        GMTday="Mon";
    if (GMTday==2)
        GMTday="Tue";
    if (GMTday==3)
        GMTday="Wed";
    if (GMTday==4)
        GMTday="Thu";
    if (GMTday==5)
        GMTday="Fri";
    if (GMTday==6)
        GMTday="Sat";

    if (month <= 9)     month   = "0" + month;
    if (date <= 9)      date    = "0" + date;
    if (hours > 11)     apm     = "pm";
    if (hours > 12)     hours   = hours - 12;
    if (hours == 0)     hours   = 12;
    if (hours <= 9)     hours   = "0" + hours;
    if (minutes <= 9)   minutes = "0" + minutes;
    if (seconds <= 9)   seconds = "0" + seconds;

    if (GMTmonth <= 9)      GMTmonth    = "0" + GMTmonth;
    if (GMTdate <= 9)       GMTdate     = "0" + GMTdate;
    if (GMThours <= 9)      GMThours    = "0" + GMThours;
    if (GMTminutes <= 9)    GMTminutes  = "0" + GMTminutes;
    if (GMTseconds <= 9)    GMTseconds  = "0" + GMTseconds;

    var NETbase     = utime/86400000*360;
    var NETdegrees  = Math.floor(NETbase%360);
    var NETminutes  = Math.floor((NETbase*60)%60);
    if (NETminutes <= 9) NETminutes = "0" + NETminutes;
    var NETstring   = NETdegrees + "°" + NETminutes + "' NET";

    var localValue  = "Local:   " + year + "." + month + "." + date + " " + day + " " + hours + ":" + minutes + ":" + seconds + "." + milliseconds + " " + apm;
    var GMTValue    = "GMT/UTC: " + GMTyear + "." + GMTmonth + "." + GMTdate + " " + GMTday + " " + GMThours + ":" + GMTminutes + ":" + GMTseconds + "." + milliseconds;
    var dtimeValue  = "Local Decimal:  " + decimaltime;
    var udtimeValue = "Decimal GMT:    " + udect; 
    var hexValue    = "Hexadecimal:    " + hexadecimalValue; 
    var NETValue    = "New Earth Time: " + NETstring; 
    var SwatchValue = "Swatch Internet Time:  " + Swatch + " .beats"; 
    var umtValue    = "Universal Metric Time: " + umt1 + "." + umt2; 
    var unixValue   = "" + utime;

    document.clock.localface.value  = localValue;
    document.clock.GMTface.value    = GMTValue;
    document.clock.dtimeface.value  = dtimeValue;
    document.clock.udtimeface.value = udtimeValue;
    document.clock.umtface.value    = umtValue;
    document.clock.hexface.value    = hexValue;
    document.clock.unixface.value   = unixValue;
    document.clock.Swatchface.value = SwatchValue;
    document.clock.NETface.value    = NETValue;

    setTimeout("Init_Multiclock()", 1);
}
