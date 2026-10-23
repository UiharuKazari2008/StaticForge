//game vars
var centerX = 65.0;
var centerY = 49.0;
var ballPosX = centerX;
var ballPosY = centerY;
var ballTrajX = -1;
var ballTrajY = -1;
var padHalfHeight = 10;
var padQuarterHeight = 5;
var padWidth = 4;
var pad1PosXCollision = 2 + padWidth;
var pad1PosY = centerY;
var pad2PosXCollision = 130 - 2 - padWidth;
var pad2PosY = centerY;
var pad1TrajY = 0;
var pad2TrajY = 0;
var padMinYVel = -3.0;
var padMaxYVel = 3.0;
var padAcceleration = 0.3;

//time control vars
var date;
var hours = 0;
var minutes = 0;
var lastHours = 0;
var lastMinutes = 0;
var changeHours = 0;
var changeMinutes = 0;
var strHours = "";
var strMinutes = "";

document.onreadystatechange = function()
//function browsertest()
{    
    if(document.readyState=="complete")
    {
		resetSizeAndPositions();
		
		date = new Date(System.Time.getLocalTime(System.Time.currentTimeZone));
		hours = lastHours = date.getHours();
		minutes = lastMinutes = date.getMinutes();
		
		updateTime("both");
		
		//update at 60 fps (~17ms)
		window.setInterval(function () {
		
			date = new Date(System.Time.getLocalTime(System.Time.currentTimeZone));
			lastHours = hours;
			lastMinutes = minutes;
			hours = date.getHours();
			minutes = date.getMinutes();
			
			if (hours != lastHours)
				changeHours = 1;
			if (minutes != lastMinutes)
				changeMinutes = 1;
				
			//keep old value for collision check
		    var ballX = ballPosX;
		    
		    //update ball
			ballPosX += ballTrajX;
			ballPosY += ballTrajY;
			
			//update pads
			pad1PosY += pad1TrajY;
			pad2PosY += pad2TrajY;
			
			//goal?
			if (ballPosX < 0) {
			
			    changeMinutes = 0;
			    updateTime("minutes");
			
				ballPosX = centerX;
				ballPosY = centerY;
				
				ballTrajX = -ballTrajX;
			}
			else if (ballPosX > 130) {
			
			    changeHours = 0;
			    updateTime("hours");
			
				ballPosX = centerX;
				ballPosY = centerY;
				
				ballTrajX = -ballTrajX;
			}
			
			//check borders
			if (ballPosY < 0) {
				ballPosY = 0;
				ballTrajY = -ballTrajY;
			}
			else if (ballPosY > 98) {
				ballPosY = 98;
				ballTrajY = -ballTrajY;
			}
			if ((pad1PosY - padQuarterHeight) < 0)
				pad1PosY = padQuarterHeight;
			else if ((pad1PosY + padQuarterHeight) > 98)
				pad1PosY = 98 - padQuarterHeight;
			if ((pad2PosY - padQuarterHeight) < 0)
				pad2PosY = padQuarterHeight;
			else if ((pad2PosY + padQuarterHeight) > 98)
				pad2PosY = 98 - padQuarterHeight;
			
			//pad movement
			
			//ball in pad1 field
			if (ballPosX < centerX) {
			
				//has to suffer a goal?
				if (ballPosY > (pad1PosY + padQuarterHeight)) 
					pad1TrajY += padAcceleration;
				else if (ballPosY < (pad1PosY - padQuarterHeight))
					pad1TrajY -= padAcceleration;
				else {
					if (pad1TrajY < 0)
						pad1TrajY = Math.min(-0.1, pad1TrajY * 0.75);
					else
						pad1TrajY = Math.max(0.1, pad1TrajY * 0.75);
				}				  
				//has to suffer a goal?
				if (changeMinutes == 1) {
					pad1TrajY = -pad1TrajY;
				}
				
				//pad2 waits for ball to come his way
				if (ballTrajX >= 0) {
					if (ballPosY > (pad2PosY + padQuarterHeight))
						pad2TrajY = 1;
					else if (ballPosY < (pad2PosY - padQuarterHeight)) 
						pad2TrajY = -1;
					else {
						if (pad2TrajY < 0)
							pad2TrajY = Math.min(-0.1, pad2TrajY * 0.75);
						else
							pad2TrajY = Math.max(0.1, pad2TrajY * 0.75);
					}
				}
				else 
					pad2TrajY = 0;
			}	
			//ball in pad2 field
			else if (ballPosX >= centerX) {
			
				if (ballPosY > (pad2PosY + padQuarterHeight)) 
					pad2TrajY += padAcceleration;
				else if (ballPosY < (pad2PosY - padQuarterHeight))
					pad2TrajY -= padAcceleration;
				else {
					if (pad2TrajY < 0)
						pad2TrajY = Math.min(-0.1, pad2TrajY * 0.75);
					else
						pad2TrajY = Math.max(0.1, pad2TrajY * 0.75);
				}
				//has to suffer a goal?
				if (changeHours == 1) {
					pad2TrajY = -pad2TrajY;
				}
					
				//pad1 waits for ball to come his way
				if (ballTrajX <= 0) {
					if (ballPosY > (pad1PosY + padQuarterHeight))
						pad1TrajY = 1;
					else if (ballPosY < (pad1PosY - padQuarterHeight)) 
						pad1TrajY = -1;
					else {
						if (pad1TrajY < 0)
							pad1TrajY = Math.min(-0.1, pad1TrajY * 0.75);
						else
							pad1TrajY = Math.max(0.1, pad1TrajY * 0.75);
					}
				}
				else 
					pad1TrajY = 0;
			}
			
			//pad speed cap
			if (pad1TrajY < 0)
			   pad1TrajY = Math.max(padMinYVel, pad1TrajY);
			else
				pad1TrajY = Math.min(padMaxYVel, pad1TrajY);
			  
			if (pad2TrajY < 0)
			   pad2TrajY = Math.max(padMinYVel, pad2TrajY);
			else
				pad2TrajY = Math.min(padMaxYVel, pad2TrajY);
			  
 			//check collisions, reversing if it wasnt colliding before
 			if (ballPosX < pad1PosXCollision)
 				testBallCollision (pad1PosY, (ballX >= pad1PosXCollision)); 			
 			else if (ballPosX > pad2PosXCollision)
 				testBallCollision (pad2PosY, (ballX <= pad2PosXCollision));
 				
			//"render"
			ball.style.left = ballPosX - 2;
			ball.style.top = ballPosY - 2;
			
			pad1.style.top = pad1PosY - 10;
			pad2.style.top = pad2PosY - 10;
		},17);
    }        
}


function testBallCollision(padLocY, reverse) 
{
	//if contained inside pad area
	if ((ballPosY < (padLocY + padHalfHeight)) && (ballPosY > (padLocY - padHalfHeight))) 
	{
		if (reverse) 
			ballTrajX = -ballTrajX;

		ballTrajY = (ballPosY - padLocY) * 0.2;
	}
}


function updateTime(part) {

	if (minutes < 10)
		strMinutes = "0" + minutes.toString();
	else 
		strMinutes = minutes.toString();
		
	if (hours < 10)
		strHours = "0" + hours.toString();
	else 
		strHours = hours.toString();
		
	if (part == "minutes") {
		minute.innerHTML = strMinutes;
	}
	else if (part == "hours") {
		hour.innerHTML = strHours;
	}
	else {
		minute.innerHTML = strMinutes;
		hour.innerHTML = strHours;
	}
}


function resetSizeAndPositions() 
{
    //if(System.Gadget.docked == true)
    //{
		line.style.width = 1;
		line.style.height = 98;
		
        pad1.style.width = 4;
        pad1.style.height = 20;
        
        pad2.style.width = 4;
        pad2.style.height = 20;
        
        ball.style.width = 4;
        ball.style.height = 4; 
        
		//width / 2 = 65
		//height / 2 = 49
		
		hour.style.left = 65 - 24;
		minute.style.left = 65 + 8;
		hour.style.top = 4;
		minute.style.top = 4;
		
		pad1.style.left = 2;
		pad1.style.top = 49 - 10;
		
		pad2.style.left = 130-4-2;
		pad2.style.top = 49 - 10;
		
		ball.style.left = 65 - 2;
		ball.style.top = 49 - 2;
		
		line.style.left = 65;
	//}
}
