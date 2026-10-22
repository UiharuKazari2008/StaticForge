// core.framework.vbs in JScript (Yozora #629): browsers run no VBScript. Same WMI query and text.
function GetUpdateInterval() {
	var UpdateInterval = 1;
	System.Gadget.Settings.write("UpdateInterval", UpdateInterval);
	return UpdateInterval * 1000;
}

function WMIDateStringToDate(dtmBootup) {
	var s = String(dtmBootup);
	return new Date(Number(s.substr(0, 4)), Number(s.substr(4, 2)) - 1, Number(s.substr(6, 2)),
		Number(s.substr(8, 2)), Number(s.substr(10, 2)), Number(s.substr(12, 2)));
}

function SetContent() {
	var objLocator = new ActiveXObject("WbemScripting.SWbemLocator");
	var objWMIService = objLocator.ConnectServer("", "root\\cimv2");
	var colOperatingSystems = objWMIService.ExecQuery("Select * from Win32_OperatingSystem");
	for (var e = new Enumerator(colOperatingSystems); !e.atEnd(); e.moveNext()) {
		var dtmLastBootUpTime = WMIDateStringToDate(e.item().LastBootUpTime);
		var intSecsTotal = Math.max(0, Math.floor((new Date() - dtmLastBootUpTime) / 1000));
		var intDays = Math.floor(intSecsTotal / 86400);
		intSecsTotal -= intDays * 86400;
		var intHours = Math.floor(intSecsTotal / 3600);
		intSecsTotal -= intHours * 3600;
		var intMinutes = Math.floor(intSecsTotal / 60);
		var intSeconds = intSecsTotal - intMinutes * 60;
		document.getElementById("uptimeCounter").innerText = intDays + " days\n" + intHours + " hours\n" + intMinutes + " minutes \n" + intSeconds + " seconds";
	}
	setTimeout(SetContent, GetUpdateInterval());
}
