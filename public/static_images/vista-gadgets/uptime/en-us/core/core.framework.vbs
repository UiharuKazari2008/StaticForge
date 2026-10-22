Function GetUpdateInterval
	UpdateInterval = 1
	System.Gadget.Settings.write "UpdateInterval", UpdateInterval
	GetUpdateInterval = UpdateInterval * 1000
End Function


Sub SetContent

	Set objLocator = CreateObject("WbemScripting.SWbemLocator")
	Set objWMIService = objLocator.ConnectServer(MachineName, "root\cimv2")
	Set colOperatingSystems = objWMIService.ExecQuery("Select * from Win32_OperatingSystem")
		 
		For Each objOS in colOperatingSystems

			dtmBootup = objOS.LastBootUpTime
			dtmLastBootupTime = WMIDateStringToDate(dtmBootup)
			dtmSystemUptimeSecs = DateDiff("s", dtmLastBootUpTime, Now)

			intSecsTotal     = dtmSystemUptimeSecs
			intDays           = Fix( intSecsTotal / 86400 )
			intSecsRemaining = ( intSecsTotal - ( intDays * 86400 ))
			intSecsTotal     = intSecsRemaining
			intHours         = Fix( intSecsTotal / 3600 )
			intSecsRemaining = ( intSecsTotal - ( intHours * 3600 ))
			intSecsTotal     = intSecsRemaining
			intMinutes       = Fix( intSecsTotal / 60 )
			intSeconds       = ( intSecsTotal - ( intMinutes * 60 ))
		 
			uptimeCounter.innerText = intDays & " days" & vbCr & intHours & " hours" & vbCr & intMinutes & " minutes " & vbCr & intSeconds & " seconds"
			setTimeout "SetContent()", GetUpdateInterval()
		
		Next
				
End Sub


Function WMIDateStringToDate(dtmBootup)
	
	WMIDateStringToDate = CDate(Mid(dtmBootup, 5, 2) & "/" & _
	Mid(dtmBootup, 7, 2) & "/" & Left(dtmBootup, 4) _
	& " " & Mid (dtmBootup, 9, 2) & ":" & _
	Mid(dtmBootup, 11, 2) & ":" & Mid(dtmBootup,13, 2))

End Function
