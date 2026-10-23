//////////////////////////////////////////////////////////////////////////
// SSettings.js                                                         //
// Rogério Tomio Hirooka - 2007.02.18 23:49                             //
// - Contém o controle da  tela de configuraçoes do Gadget              //
//////////////////////////////////////////////////////////////////////////



var Playing 		= 	false;

var Skin_Previews	=	[];

Skin_Previews[0]	=	"red";
Skin_Previews[1]	=	"lcd";
Skin_Previews[2]	=	"green";
Skin_Previews[3]	=	"default";
Skin_Previews[4]	=	"darkblue";

var CurrSkin		=	3;

System.Gadget.onSettingsClosing = Settings_onClosing;

function Settings_onClosing(event)
{
	if (event.closeAction == event.Action.commit) 
	{
		// Salva os valores de configuração.
		Save_Alarms();
		
		// Caso o som de alarme esteja preenchido, salva-o
		if (lblSoundFile_invisible.innerText != "")
		{
			System.Gadget.Settings.writeString("Alarm_File" , lblSoundFile_invisible.innerText);
		}
		
		// Salva a configuração de exibição de segundos
		System.Gadget.Settings.writeString("Show_Seconds" , (chk_Segundos.checked?"1":"0"));
		
		// Salva a configuração AM/PM
		System.Gadget.Settings.writeString("Show_AMPM" , (chkAMPM.checked?"1":"0"));
		
		// Salva a skin atual
		System.Gadget.Settings.writeString("CurrSkin", CurrSkin);
	}
}

function Settings_onLoad()
{
	Load_Alarms();
	
	if (System.Gadget.Settings.readString("Alarm_File") == "")
	{
		lblSoundFile_invisible.innerText = System.Gadget.path + "\\res\\alarm.wav";
	}
	else
	{
		lblSoundFile_invisible.innerText = System.Gadget.Settings.readString("Alarm_File");
	}
	
	// altera o item do label.
	if (lblSoundFile_invisible.innerText.length > 30)
	{
		lblSoundFile_visible.innerText = lblSoundFile_invisible.innerText.substring(0, 30) + "(...)";
	}
	else
	{
		lblSoundFile_visible.innerText = lblSoundFile_invisible.innerText;
	}
	
	if (System.Gadget.Settings.readString("Show_Seconds") == "")
	{
		chk_Segundos.checked = true;
	}
	else
	{
		chk_Segundos.checked = (System.Gadget.Settings.readString("Show_Seconds") == "1");
	}
	
	if (System.Gadget.Settings.readString("Show_AMPM") == "")
	{
		chkAMPM.checked = false;
	}
	else
	{
		chkAMPM.checked = (System.Gadget.Settings.readString("Show_AMPM") == "1");
	}
	
	// Carrega a skin configurada
	if (System.Gadget.Settings.readString("CurrSkin") == "")
	{
		CurrSkin = 3;
	}
	else
	{
		CurrSkin = Math.floor(System.Gadget.Settings.readString("CurrSkin"));
	}
	
	ShowSkin();
	
}

function Save_Alarms()
{
	// Salva os alarmes armazenados no listbox
	var Alarms_Text;
	
	for(var i = 0; i < lstAlarmes.options.length; i++) 
	{
		var	cmd_value	= lstAlarmes.options[i].value;
		if (i == 0)
		{
			Alarms_Text = cmd_value;
		}
		else
		{
			Alarms_Text = Alarms_Text + ";" + cmd_value;
		}
	}
	
	System.Gadget.Settings.writeString("Alarms" , Alarms_Text);
}

function Load_Alarms()
{
	// Deserializa a array de alarmes.
	if (System.Gadget.Settings.readString("Alarms") != "")
	{
		var Alarms_Text;
		Alarms_Text = System.Gadget.Settings.readString("Alarms");
		var Elements;
		Elements = Alarms_Text.split(";");

		// Limpa a listbox
		clear_Alarm_listbox();
		
		// Carrega os itens na listbox
		for (var x = 0; x < Elements.length; x++)
		{
			var Element = Elements[x];
			lstAlarmes.add(new Option(Element, Element));
		}
	}
}

function cmdRemover_onclick()
{
	// Remove um determinado item selecionado na 
	// listbox.
	if (lstAlarmes.selectedIndex != -1)
	{
		lstAlarmes.remove(lstAlarmes.selectedIndex);	
	}
}

function clear_Alarm_listbox()
{
    // Limpa a listbox
	while (lstAlarmes.options.length > 0)
	{
		lstAlarmes.remove(0);
	}
}

function cmdApagar_onclick()
{
	clear_Alarm_listbox();
}

function cmdEscolher_onclick()
{
	var shellitem = System.Shell.chooseFile(true, 
		"Sound Files (aif,au,mid,mp3,wav,wma):*.aif;*.au;*.mid;*.mp3;*.wav;*.wma::", "", "");
	if(shellitem!=null)
	{
		// altera o item do label.
		if (shellitem.path.length > 30)
		{
			lblSoundFile_visible.innerText = shellitem.path.substring(0, 30) + "(...)";
		}
		else
		{
			lblSoundFile_visible.innerText = shellitem.path;
		}		
		
		lblSoundFile_invisible.innerText = shellitem.path;
	}
}	

function cmdTocar_onclick()
{
	
	Playing = !Playing;
	if (Playing)
	{
		cmdTocar.value = "Stop";
		sound_test.src = lblSoundFile_invisible.innerText;
	}
	else
	{
		cmdTocar.value = "Play";
		sound_test.src = "";
	}

}

function cmdAdicionar_onclick()
{
	// Verifica se o item na textbox é válido
	// - Quebra o item em 2 membros (no 'dois pontos')

	var Members;
	Members = txtAlarm.value.split(":");

	error_label.innerText = "Error: Incorrect Value! Format: HH:MM";
	
	if (Members.length != 2)
	{
		error_label.style.visibility = "";
		return;
	}
	
	// Verifica se ambos os membros são numéricos
	if (isNaN(Members[0]) || isNaN(Members[1]))
	{
		error_label.style.visibility = "";
		return;
	}
	
	// Verifica se ambos possuem dois dígitos
	if ((Members[0].length != 2) || (Members[1].length != 2))
	{
		error_label.style.visibility = "";
		return;
	}

	// verifica se ambos são valores positivos.
	if ((Members[0] < 0) || (Members[1] < 0))
	{
		error_label.style.visibility = "";
		return;
	}

	// Verifica se o item já existe
	for(var i = 0; i < lstAlarmes.options.length; i++) 	
	{
		var	cmd_value	= lstAlarmes.options[i].value;
		if (cmd_value == txtAlarm.value)
		{
			error_label.innerText = "Error: Alarm already stored!";
			error_label.style.visibility = "";
			return;
		}
	}
	
	// Registra o valor
	error_label.style.visibility = "hidden";
	lstAlarmes.add(new Option(txtAlarm.value, txtAlarm.value));
	
}

function cmd_NextSkin()
{
	// CurrSkin varia de 0 a 4
	if (CurrSkin >= 4)
	{
		CurrSkin = 0;
	}
	else
	{
		CurrSkin += 1;
	}
	ShowSkin();	
}

function cmd_PreviousSkin()
{
	// CurrSkin varia de 0 a 4
	if (CurrSkin <= 0)
	{
		CurrSkin = 4;
	}
	else
	{
		CurrSkin -= 1;
	}
	ShowSkin();
}

function ShowSkin()
{
	SkinPreview.src = "images/common/" + Skin_Previews[CurrSkin] + ".png" ;
}






