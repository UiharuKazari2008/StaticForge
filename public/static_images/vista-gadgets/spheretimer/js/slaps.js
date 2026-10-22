//////////////////////////////////////////////////////////////////////////
// SLaps.js                                                             //
// Rogério Tomio Hirooka - 2007.02.17 21:39                             //
// - Contém o controle de Laps do módulo Cronometro do Gadget           //
//////////////////////////////////////////////////////////////////////////


function Reload_Laps()
{
    // Limpa a lista atual
	while (lstLaps.options.length > 0)
	{
		lstLaps.remove(0);
	}
	
	// Efetua a leitura da array de Laps
    for(var i = 0; i < System.Gadget.document.parentWindow.Lap_Array.length; i++) 
    {
        var CurrText = System.Gadget.document.parentWindow.Lap_Array[i];
        lstLaps.add(new Option(CurrText, i));
    }
   
}


function cmdRemoverTodos_onclick()
{
    // Apaga a lista de Laps

    // Limpa a array
    while (System.Gadget.document.parentWindow.Lap_Array.length > 0)
    {
        System.Gadget.document.parentWindow.Lap_Array.pop();
    }
    
    // Limpa a listbox
	while (lstLaps.options.length > 0)
	{
		lstLaps.remove(0);
	}
	
}

function cmdDel_onclick()
{
	if (lstLaps.length != 0)
	{
	    var Key = lstLaps.options[lstLaps.selectedIndex].value;
	
		System.Gadget.document.parentWindow.Lap_Array.splice(lstLaps.selectedIndex, 1);
	    
		Reload_Laps();
	}
}

function cmdFechar_onclick()
{
    System.Gadget.Flyout.show = false;
}