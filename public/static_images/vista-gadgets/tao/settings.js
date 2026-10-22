    ///////////////////////////////////////////////
    //
    //When the settings pane is closed, the settings must be saved
    //
    ///////////////////////////////////////////////
    
System.Gadget.onSettingsClosing = SettingsClosing;
    function SettingsClosing(event)
    {
        if (event.closeAction == event.Action.commit) // if the ok button is pressed
        {
		    System.Gadget.Settings.write("image", img.value);
        }
        event.cancel = false; // otherwise, (the cancel button is pressed) do not save
    }
    
    ///////////////////////////////////////////////
    //
    //To get the initial values to put in the pdm's list
    //
    ///////////////////////////////////////////////
    function init()
    {
        var currentImage = System.Gadget.Settings.read("image");
		if (currentImage == "Vista.png")
		{
			images.innerHTML = '<select id="img" onChange="changePreview()"><option value="YinYang.png">YinYang</option><option value="Vista.png" Selected="Selected">Vista</option></select>';
		}
		changePreview();
    }
	
	function changePreview()
	{
		if (img.value == "Vista.png")
			preview.innerHTML = '<img src="Vista.png" />';
		else if (img.value == "YinYang.png")
			preview.innerHTML = '<img src="YinYang.png" />';
	}