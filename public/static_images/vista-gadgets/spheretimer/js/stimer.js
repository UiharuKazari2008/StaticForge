//////////////////////////////////////////////////////////////////////////
// STimer.js                                                            //
// Rogério Tomio Hirooka - 2007.02.12 18:07                             //
// - Representa a lógica do Gadget.                                     //
//////////////////////////////////////////////////////////////////////////


//************************************************************************
// Variáveis de Dimensionamento
// - Armazenam as informações de dimensionamento dos
//   elementos do gadget.
//************************************************************************
// Modo docked
var Gadget_Size_D       =   { width : 130, height :  72 };
// Modo undocked
var Gadget_Size_U       =   { width : 202, height : 113 };


//************************************************************************
// Variáveis de Controle
//************************************************************************
var IsDocked                =   false;
var IsFlyOuted              =   false;
var CurrResourceFolder      =   "";
var Alarm_On                =   false;

var clock_timer             =   0;

// Utilizado pelos sistemas de contagem regressiva e progressiva.
var count_value             =   0;
var countdown_inprogress    =   false;
var countup_inprogress      =   false;
var count_timer             =   0;
var Count_StartTime         =   0;
var Count_StartValue        =   0;
var Count_CurrentValue      =   0;

// Utilizado pelo cronometro.
var chrno_timer             =   0;
var chrno_reference_init    =   0;
var chrno_running           =   false;
var chrno_offset            =   0;
var chrno_offsetmilissec    =   0;

var Alarm_File              =   "res/alarm.wav";

var Former_Frame            =   "frmMain";
var hidetimer               =   0;

var Lap_Array               =   new Array();

// Cache de configurações
var	Alarms_Array			=	new Array();
var Show_Seconds			=	true;
var Show_AMPM				=	false;

var Alarms_Array_CurrIndex	=	0;

// Cache de Skins
var Skin_TextColors			=	[];

Skin_TextColors[0]			=	"#FF7481"; // Red
Skin_TextColors[1]			=	"#000000"; // LCD
Skin_TextColors[2]			=	"#39FF5D"; // Green
Skin_TextColors[3]			=	"#000000"; // Default
Skin_TextColors[4]			=	"#397FFF"; // Blue

// Cache de BGImages
var Skin_Backs				=	[];

Skin_Backs[0]				=	"back_red.png";	// Red
Skin_Backs[1]				=	"back_lcd.png";	// LCD
Skin_Backs[2]				=	"back_green.png"; // Green
Skin_Backs[3]				=	"back.png";		// Default
Skin_Backs[4]				=	"back_darkblue.png"; // Blue

var CurrentSkin				=	3;

// Strings [Ingês - Estados Unidos]
var L_DOM					=	"SUN";
var L_SEG					=	"MON";
var L_TER					=	"TUE";
var L_QUA					=	"WED";
var L_QUI					=	"THU";
var L_SEX					=	"FRI";
var L_SAB					= 	"SAT";
var L_ErrorIcon				=	"Click here to hide this message";
var L_LblMsg_Incorreto		= 	"Incorrect Input.";
var L_LblMsg_Alarme			= 	"Alarm Fired: ";
var L_Alarm_Disable			=	"Click here to disable the alarm.";
var	L_Alarm_Disable_Alt		=	"Disable Alarm";
var L_Alarm_Enable_Alt		=	"Enable Alarm";
var L_NoAlarm				=	"No Alarms";
var L_Alarm					=	"Alarm ";

//************************************************************************
// evento gadget_onload
// - Configura o comportamento do gadget e sua aparência
//************************************************************************
function gadget_onload()
{
    bring_toFront('frmMain');
    Load_Settings();
    Setup_Properties();
	Set_Texts();
    Config_Images();
    Config_Sizes();
    Config_Pos();
    
    System.Gadget.onDock            = gadget_onDock;
    System.Gadget.onUndock          = gadget_onUndock;
    System.Gadget.onSettingsClosed  = gadget_onSettingsClosed;
    StartClock();
}

//************************************************************************
// função Set_Texts
// - Determina configurações de texto (Cor e Blur)
// - Update 2007.02.20 - Rogério
//	 Configurações de Blur removidas: Combinação de PNG semitransparente
//   (shine.png) com texto com filtro blur resulta em deformidade visual.
//************************************************************************
function Set_Texts()
{
	// Aplica as configurações de cor nos textos
	var CurrColor					= Skin_TextColors[CurrentSkin];
	lblDay.style.color				= CurrColor;
	lblAMPM.style.color				= CurrColor;
	lblTime.style.color				= CurrColor;
	lblSeconds.style.color			= CurrColor;
	lblAlarm.style.color			= CurrColor;
	Alarm_id.style.color			= CurrColor;
	lblCount.style.color			= CurrColor;
	txtCount.style.color			= CurrColor;
	lblChrno.style.color			= CurrColor;
	lblMsg.style.color				= CurrColor;
}

//************************************************************************
// função UpdateClock
// - Atualiza o relógio do gadget.
//************************************************************************
function UpdateClock() 
{
	if(clock_timer) 
	{
		clearTimeout(clock_timer);
		clock_timer  = 0;
	}
	
	var tDate   = new Date();
	var tSeconds = tDate.getSeconds();
	
	var Horas 	= tDate.getHours();
	var IsPM	= false;
	
	if (Horas	== 12)
	{
		IsPM	= true;
	}
	if (Horas 	== 0)
	{
		IsPM	= false;
		Horas	= 12;
	}
	if (Horas 	> 12)
	{
		Horas 	= tDate.getHours() - 12;
		IsPM 	= true;
	}

   //01
   if ((!Show_AMPM) && (Show_Seconds))
   {
	   lblTime.innerText = "" 
           + FixDigits_2(tDate.getHours()) 
           + (((tSeconds % 2) == 0)?":":" ")
           + FixDigits_2(tDate.getMinutes());
	   lblAMPM_frame.style.visibility = "hidden";
	   lblSeconds.innerText = FixDigits_2(tSeconds);
   }
   //10
   if ((Show_AMPM) && (!Show_Seconds))
   {
		lblTime.innerText = "" 
			+ FixDigits_2(Horas) 
			+ ":"
			+ FixDigits_2(tDate.getMinutes());
		lblAMPM_frame.style.visibility = "hidden";
		lblSeconds.innerText = (IsPM)?"PM":"AM";
   }
   
   //11
   if ((Show_AMPM) && (Show_Seconds))
   {
	   lblTime.innerText = "" 
           + FixDigits_2(Horas) 
           + (((tSeconds % 2) == 0)?":":" ")
           + FixDigits_2(tDate.getMinutes());
	           
	   lblSeconds.innerText = FixDigits_2(tSeconds);
	   lblAMPM_frame.style.visibility = "";
	   lblAMPM.innerText = (IsPM)?"PM":"AM";
   }
   //00
   if ((!Show_AMPM) && (!Show_Seconds))
   {
       lblAMPM_frame.style.visibility = "hidden";
       lblSeconds.innerText = "";
	   lblTime.innerText = "" 
           + FixDigits_2(tDate.getHours()) 
           + ":"
           + FixDigits_2(tDate.getMinutes());
   }
   
   var day         = tDate.getDay();
   switch(day)
   {
        case 0: lblDay.innerText = L_DOM; break;
        case 1: lblDay.innerText = L_SEG; break;
        case 2: lblDay.innerText = L_TER; break;
        case 3: lblDay.innerText = L_QUA; break;
        case 4: lblDay.innerText = L_QUI; break;
        case 5: lblDay.innerText = L_SEX; break;
        case 6: lblDay.innerText = L_SAB; break;
   }
   
   // Verifica se algum dos alarmes foi atingido
   if (Alarm_On)
   {
   		var FormattedTime = FixDigits_2(tDate.getHours())
   				+ ":" + FixDigits_2(tDate.getMinutes());
   		Verify_Alarm(FormattedTime);
   }
      
   clock_timer = setTimeout("UpdateClock()", 1000);
}

//************************************************************************
// função Verify_Alarm
// - Verifica os alarmes configurados, e caso um deles tenha sido 
//	 atingido, inicia a reprodução do som.
//************************************************************************
function Verify_Alarm(TimeText)
{
	// Verifica se algum dos alarmes possui o texto atual
	
	for (var x = 0; x < Alarms_Array.length; x++)
	{
		if (TimeText == Alarms_Array[x])
		{
			// Ativa o som do alarme
			
			Alarm_On = true;
			cmdAlarm_onclick();
			
	        //Inicia o som de alarme
	        sound.loop = "INFINITE";
	        sound.src = Alarm_File;
	        
	        bring_toFront('Messagebox');
	        lblMsg.innerText = L_LblMsg_Alarme + TimeStamp_HHMM();
	        ErrorIcon.alt = L_Alarm_Disable;
	        ErrorIcon.src = CurrResourceFolder + "info.png";
	
	        // Para a contagem, exibindo alarme na flyout.
	        System.Gadget.Flyout.show       = false;
	        System.Gadget.Flyout.file       = "alarm.htm";
	        System.Gadget.Flyout.onShow     = Event_Flyout_onShow;
	        System.Gadget.Flyout.onHide     = Event_Flyout_onHide;
	        System.Gadget.Flyout.show       = true;
			
			return;
		}
	}
}


//************************************************************************
// função StartClock
// - Inicia o relógio do gadget.
//************************************************************************
function StartClock() 
{
   clock_timer = setTimeout("UpdateClock()", 1);
}

//************************************************************************
// função StopClock
// - Para o relógio do gadget.
//************************************************************************
function StopClock() 
{
   if(clock_timer) 
   {
      clearTimeout(clock_timer);
      clock_timer  = 0;
   }
}

//************************************************************************
// função FixDigits_2
// - Retorna a string numérica de entrada sempre com duas casas, 
//   adicionando zero a esquerda quando necessário.
//************************************************************************
function FixDigits_2(ivalue)
{
    if (ivalue >= 10)
    {
        return(ivalue);
    }
    else
    {
        return('0' + ivalue);
    }
}

//************************************************************************
// função FixDigits_3
// - Retorna a string numérica de entrada sempre com tres casas, 
//   adicionando zeros a esquerda conforme necessário.
//   Utilizado pela mostragem de milissegundos do cronometro.
//************************************************************************
function FixDigits_3(ivalue2)
{
    if (ivalue2 >= 100)
    {
        return (ivalue2);
    }
    if (ivalue2 >= 10)
    {
        return ('0' + ivalue2);
    }
    else
    {
        return ('00' + ivalue2);
    }
}

//************************************************************************
// evento lblTime_frame_onclick
// - evento disparado durante click no frame do relógio principal
//   Efetua a exibição do relógio múltiplo como flyout.
//************************************************************************
function lblTime_frame_onclick()
{
    System.Gadget.Flyout.file       = "flyout.htm";
    System.Gadget.Flyout.onShow     = Event_Flyout2_onShow;

    System.Gadget.Flyout.show = true;
}

//************************************************************************
// função bring_toFront
// - Oculta os frames e exibe somente o frame desejado.
//************************************************************************
function bring_toFront(id)
{
    frmMain.style.visibility     = "hidden";
    Alarm_frame.style.visibility = "hidden";
    Count_frame.style.visibility = "hidden";
    Chrno_frame.style.visibility = "hidden";
    Messagebox.style.visibility  = "hidden";
    
    document.getElementById(id).style.visibility="";
}

//************************************************************************
// evento cmdDel_onclick
// - Disparado durante o click no botão del do contador
//	 Efetua o reset do contador e restaura as imagens padrão (inclusive
//   restaurando estado de Pause.
//************************************************************************
function cmdDel_onclick()
{
    txtCount.value = "00:00:00";
    lblCount.innerText = "00:00:00";
    Reset_CountImages();
    count_value = 0;
    Pause_Count();
}

//************************************************************************
// função Reset_CountImages
// - Efetua o reset das imagens dos botões do contador (regressivo e
//   progressivo.
//************************************************************************
function Reset_CountImages()
{
    btn_Up.src   = CurrResourceFolder + "up.png";
    btn_Down.src = CurrResourceFolder + "down.png";    
}

//************************************************************************
// função Init_Count
// - Inicia o contador. (contagem regressiva ou progressiva)
//************************************************************************
function Init_Count()
{
    // Inicia o contador com o valor atual.
    var tNow    = new Date();

    Count_StartTime     = Time_To_Seconds(tNow);
    Count_StartValue    = Validate_Time(txtCount.value);
    
    Stop_CountTimer();
    
    if (Count_StartValue == -1)
    {
        cmdDel_onclick();
        // erro, valor inválido de entrada
        // exibe mensagem 
        bring_toFront('Messagebox');
        ErrorIcon.alt = L_ErrorIcon;
        ErrorIcon.src = CurrResourceFolder + "error.png";
        lblMsg.innerText = L_LblMsg_Incorreto;
        // oculta o messagebox em 5 segundos
        hidetimer = setTimeout("Hide_MessageBox()", 4000);
        Former_Frame = "Count_frame";
        Reset_CountImages();
    }
    else
    {
        Count_Step();
    }
}

//************************************************************************
// função Hide_MessageBox
// - Oculta o messagebox (seja erro ou alarme), e exibe o frame 
//   que estava sendo anteriormente exibido.
//************************************************************************
function Hide_MessageBox()
{
    bring_toFront(Former_Frame);
}

//************************************************************************
// evento ErrorIcon_onclick
// - evento disparado durante click no ícone de erro do "messagebox"
//   Desativa o alarme (caso necessário) e restaura o frame anterior.
//************************************************************************
function ErrorIcon_onclick()
{
    // desativa o som do gadget, se existir
    sound.src = "";
    System.Gadget.Flyout.show = false;

    bring_toFront(Former_Frame);
    if (hidetimer)
    {
        clearTimeout(hidetimer);
        hidetimer = 0;
    }
}

//************************************************************************
// função TimeStamp_HHMM 
// - Retorna timestamp atual do horário no formato HHMM com duas casas
//   Decimais por elemento
//************************************************************************
function TimeStamp_HHMM()
{
    var nDate = new Date();
    return (FixDigits_2(nDate.getHours()) + ":" + FixDigits_2(nDate.getMinutes()));
}

//************************************************************************
// função Pause_Count
// - Pausa o contador.
//************************************************************************
function Pause_Count()
{
    countdown_inprogress = false;
    countup_inprogress   = false;
    
    Stop_CountTimer();
        
}

//************************************************************************
// função Stop_CountTimer 
// - Para o contador.
//************************************************************************
function Stop_CountTimer()
{
    if(count_timer) 
    {
        clearTimeout(count_timer);
        count_timer  = 0;
    }
}

//************************************************************************
// função Count_Step 
// - Executa um passo progressivo do contador. Evento realimentado a cada
//   segundo.
// - Update: 2007.02.18 - 04:33
//   Para melhorar a precisão do relógio, o contador agora se baseia na
//   diferença matemática dos horários de partida e atuais do contador.
//   Isso remove o problema de precisão apresentado pela inequalidade dos
//   contadores javascript. A mesma solução foi aplicada no cronometro.
//************************************************************************
function Count_Step()
{
    // Avança (ou retrocede) um passo no contador.
    if ((!countdown_inprogress) && (!countup_inprogress))
    {
        // Não estando nenhuma das contagens ativa, torna Count_StartTime = now
        Count_StartTime = Time_To_Seconds(new Date());
        Stop_CountTimer();
    }
    else
    {
        var dif = Time_To_Seconds(new Date()) - Count_StartTime;
        
        if (dif < 0) { dif = -dif; }
        
        if (countdown_inprogress)
        {
            Count_CurrentValue = Count_StartValue - dif;
        }
        if (countup_inprogress)
        {
            Count_CurrentValue = Count_StartValue + dif;
        }
        
        lblCount.innerText = Seconds_To_Time(Count_CurrentValue);
        
        if ((lblCount.innerText == "00:00:00") && (countdown_inprogress))
        {
            if (!System.Gadget.Flyout.show)
            {
                cmdDel_onclick();
                Stop_CountTimer();
                
                //Inicia o som de alarme
                sound.loop = "INFINITE";
                sound.src = Alarm_File;
                
                bring_toFront('Messagebox');
                lblMsg.innerText = L_LblMsg_Alarme + TimeStamp_HHMM();
                ErrorIcon.alt = L_Alarm_Disable;
                ErrorIcon.src = CurrResourceFolder + "info.png";

                // Para a contagem, exibindo alarme na flyout.
                System.Gadget.Flyout.show       = false;
                System.Gadget.Flyout.file       = "alarm.htm";
                System.Gadget.Flyout.onShow     = Event_Flyout_onShow;
                System.Gadget.Flyout.onHide     = Event_Flyout_onHide;
                System.Gadget.Flyout.show       = true;
                //System.Gadget.Flyout.document.parentWindow.alarmfile = Alarm_File;
                //System.Gadget.Flyout.document.parentWindow.AlarmSet();
            }
            return;
        }
    }
    
    // Realimenta o procedimento
    count_timer = setTimeout("Count_Step()", 1000);
    
}


//************************************************************************
// evento Event_Flyout_onShow
// - Efetua a configuração do conteúdo da janela de Flyout do gadget ao 
//   abri-la. Este evento é chamado pelo alarme ao ser disparado (seja o
//   alarme normal ou o countdown).
//************************************************************************
function Event_Flyout_onShow()
{
    // Alteração 2007.02.16 - Rogério
    // - Quando o foco não está sobre o gadget, o flyout não é exibido, o que 
    //   impede a reprodução do som de alerta.
    // - Solução: O elemento de reprodução de som será transferido para o gadget
    //   principal.
    /*
    System.Gadget.Flyout.document.parentWindow.sound.loop = "INFINITE";
    System.Gadget.Flyout.document.parentWindow.sound.src = Alarm_File;
    */
    
    var time1 = new Date();
    System.Gadget.Flyout.document.parentWindow.Tempo.innerText = FixDigits_2(time1.getHours()) + ":" + FixDigits_2(time1.getMinutes());
}

//************************************************************************
// evento Event_Flyout2_onShow
// - Evento vazio. Disparado durante exibição do flyout, entretanto,
//   tratando-se do flyout multiclock.
//************************************************************************
function Event_Flyout2_onShow()
{}

//************************************************************************
// evento Event_Flyout3_onShow
// - Evento vazio. Disparado durante exibição do flyout, entretanto,
//   tratando-se do flyout de Laps do cronometro.
//************************************************************************
function Event_Flyout3_onShow()
{
    // Escreve a collection de Laps do cronometro no flyout.
    
}

//************************************************************************
// evento Event_Flyout_onHide
// - Evento vazio. Disparado durante fechamento do flyout.
//************************************************************************
function Event_Flyout_onHide()
{
    //sound.src = "";
}

//************************************************************************
// evento cmd_Lap_onclick
// - Disparado durante click no botão "Lap".
//   Inclui valor atual do cronometro na array de Laps, e exibe a lista
//   de laps armazenadas (como flyout).
//************************************************************************
function cmd_Lap_onclick()
{
    // Toma o valor atual do cronômetro e inclui no Lap
    Lap_Array.push(lblChrno.innerText);

    System.Gadget.Flyout.file       = "chrno_laps.htm";
    System.Gadget.Flyout.onShow     = Event_Flyout3_onShow;

    System.Gadget.Flyout.show = true;
}

//************************************************************************
// evento cmdUp_onclick
// - casa haja contagem regressiva em andamento (countdown_inprogress), 
//   inverte o sentido da contagem, tornando (countup_inprogress = true) e
//   desativa a contagem regressiva. A contagem tem como partida o valor
//   atual da contagem regressiva.
// - caso haja contagem progressiva em andamento(countup_inprogress), pausa 
// - caso contrário, Verifica se o valor do timestamp de entrada é válido. 
//   Não sendo, aborta a rotina.
//************************************************************************
function cmdUp_onclick()
{
    if (countdown_inprogress)
    {
        // Efetiva a alteração de sentido, efetuando um Pause, e um Start (reverse)
        Pause_Count();

        txtCount.value = lblCount.innerText;

        // Inverte sentido da contagem
        countdown_inprogress = false;
        countup_inprogress   = true;
        
        Init_Count();
        
        // Altera a src do cmdUp (para pause)
        btn_Up.src   = CurrResourceFolder + "pause.png";
        // Volta o src do cmdDown para down
        btn_Down.src = CurrResourceFolder + "down.png";
    }
    else
    {
        if (countup_inprogress)
        {
            // Pausa a contagem
            // Ao pausar a contagem, transfere o valor do label de contagem
            // para o textbox de timestamp.
            countdown_inprogress = false;
            countup_inprogress   = false;
            
            txtCount.value = lblCount.innerText;
            
            // restaura a imagem para "count up".
            btn_Up.src  = CurrResourceFolder + "up.png";
        }
        else
        {
            // Não havendo nenhuma contagem em andamento, inicia a contagem progressiva a partir 
            // do valor especificado na inputbox.
            
            countup_inprogress = true;
            
            Init_Count();
            
            // altera a imagem do botão para "Pause"
            btn_Up.src   = CurrResourceFolder + "pause.png";            
        }
    }
}

//************************************************************************
// evento cmdUp_onclick
// - Análogo ao  cmdDown_onclick 
//************************************************************************
function cmdDown_onclick()
{
    if (countup_inprogress)
    {
        Pause_Count();
        
        txtCount.value = lblCount.innerText;

        // Inverte sentido da contagem
        countdown_inprogress = true;
        countup_inprogress   = false;
        
        // Efetiva a alteração de sentido, efetuando um Pause, e um Start (reverse)
        Init_Count();
        
        // Volta o src do cmdUp para Up
        btn_Up.src   = CurrResourceFolder + "up.png";
        // Altera a src do cmdDown (para pause)
        btn_Down.src = CurrResourceFolder + "pause.png";
    }
    else
    {
        if (countdown_inprogress)
        {
            // Pausa a contagem
            // Ao pausar a contagem, transfere o valor do label de contagem
            // para o textbox de timestamp.
            countdown_inprogress = false;
            countup_inprogress   = false;
            
            txtCount.value = lblCount.innerText;
            
            // restaura a imagem para "count down".
            btn_Down.src  = CurrResourceFolder + "down.png";
        }
        else
        {
            // Não havendo nenhuma contagem em andamento, inicia a contagem progressiva a partir 
            // do valor especificado na inputbox.
            
            countdown_inprogress = true;
            
            Init_Count();
            
            // altera a imagem do botão para "Pause"
            btn_Down.src   = CurrResourceFolder + "pause.png";            
        }
    }
}

//************************************************************************
// função Validate_Time
// - Verifica se a entrada especificada é um timestamp válido.
// - Caso seja, retorna um valor inteiro (equivalente ao timestamp em 
//   segundos.
// - Caso não seja válido, retorna -1.
//************************************************************************
function Validate_Time(invalue)
{
    //if (invalue.length != 8) return (-1);
    
    var members = new Array();
    members = invalue.split(':');
    
    var invalue_inseconds = 0;
    
    // exemplo
    // invalue = '01:22:32'
    // members[0] = 01
    // members[1] = 22
    // members[2] = 32
    
    try
    {
        invalue_inseconds =   Math.floor(members[2]);
        invalue_inseconds += (Math.floor(members[1]) * 60);
        invalue_inseconds += (Math.floor(members[0]) * 3600);
        
        if (isNaN(invalue_inseconds))
        {
            return(-1);
        }
        
        return (invalue_inseconds);
    }
    catch(err)
    {
        return (-1);
    }
}

//************************************************************************
// função Time_To_Seconds 
// - Converte um valor de tempo no número de segundos correspondente.
//************************************************************************
function Time_To_Seconds(iValueAsTime)
{
   var totSeconds = iValueAsTime.getSeconds()
                  + (iValueAsTime.getHours() * 3600)
                  + (iValueAsTime.getMinutes() * 60);
    return (totSeconds);
}

//************************************************************************
// função Seconds_To_Time
// - Apartir de uma entrada em segundo, gera uma timestamp
//************************************************************************
function Seconds_To_Time(iValueinSeconds)
{
    if (iValueinSeconds <= 0)
    {
        return "00:00:00";
    }

    // Remove as horas inteiras;
    var iHoras = Math.floor(iValueinSeconds / 3600);
    iValueinSeconds -= (iHoras * 3600);
    
    var iMinutos = Math.floor(iValueinSeconds / 60);
    var iSeconds = Math.floor(iValueinSeconds % 60);
    
    return (FixDigits_2(iHoras) + ":" + FixDigits_2(iMinutos) + ":" + FixDigits_2(iSeconds));
}

//************************************************************************
// evento cmd_Start_Pause_onclick
// - evento disparado durante click no botão start / pause do cronometro.
//************************************************************************
function cmd_Start_Pause_onclick()
{
    if (chrno_running)
    {
        Chrno_Pause();
    }
    else
    {
        Chrno_Init();
    }
}

//************************************************************************
// evento cmd_Off_onclick
// - evento disparado durante click no botão Off do cronometro.
//************************************************************************
function cmd_Off_onclick()
{
    Chrno_Pause();
    lblChrno.innerText = "00:00:00.000";
}

//************************************************************************
// função Chrno_Init 
// - inicia o cronometro
//************************************************************************
function Chrno_Init()
{
    // Inicia o cronometro, setando valor de referencia como 'now'.
    chrno_reference_init = new Date();
    
    //chrno_offset
    if (lblChrno.innerText != "00:00:00.000")
    {
        chrno_offset = Validate_Time(lblChrno.innerText);
    }
    else
    {
        chrno_offset = 0;
    }
    
    chrno_offsetmilissec = Math.floor(lblChrno.innerText.substr(9,13));
    
    cmd_Start_Pause.src = CurrResourceFolder + "pause.png";
    chrno_running = true;
    
    Chrno_Step();
}

//************************************************************************
// função Chrno_Pause
// - Pausa o cronometro
//************************************************************************
function Chrno_Pause()
{

    cmd_Start_Pause.src = CurrResourceFolder + "play.png";
    chrno_running = false;

   if(chrno_timer) 
   {
      clearTimeout(chrno_timer);
      chrno_timer  = 0;
   }
}

//************************************************************************
// função retMilisseconds
// - A partir de um valor tempo, retorna os milissegundos
//************************************************************************
function retMilisseconds(intimevalue)
{
    return((intimevalue*1000).toString().substring(10,13));
}

//************************************************************************
// função Chrno_Step
// - Função realimentada a cada milisegundo, calcula a diferença entre
//   o último evento de pause e o momento atual (para incrementar a
//   precisão.
//************************************************************************
function Chrno_Step()
{
    // Recupera a diferença de tempo em segundos
    var dif = Time_To_Seconds(new Date()) - Time_To_Seconds(chrno_reference_init) + chrno_offset;

    // Recupera a diferença de tempo em milisegundos
    //var utime        = chrno_reference_init.getTime();
    var milliseconds = retMilisseconds(chrno_reference_init);
    
    //lblChrno.innerText = dif;
    
    var difms = Math.floor(retMilisseconds(new Date())) - milliseconds;
    
    // aplica o offset em milissegundos ao difms
    difms += chrno_offsetmilissec;

    if (difms < 0) {difms = 1000+difms; }
        
    if (difms >= 1000)
    {
        difms = Math.floor(difms) - 1000;
        dif   = Math.floor(dif) + 1;
    }
    
    var text_display = Seconds_To_Time(dif) + "." + FixDigits_3(difms);
    
    lblChrno.innerText = text_display;
    
    if(chrno_timer) 
    {
        clearTimeout(chrno_timer);
        chrno_timer  = 0;
    }    

    chrno_timer = setTimeout("Chrno_Step()", 1);
}


//************************************************************************
// evento cmdAlarm_onclick 
// - Disparado durante click no botão Alarme, ativa ou desativa o estado
//   dos alarmes configurados.
//************************************************************************
function cmdAlarm_onclick()
{
    Alarm_On = ((Alarm_On)?false:true);
    Alarm_img.src = CurrResourceFolder + ((Alarm_On)?"alarm_1.png":"alarm_0.png");
    Alarm_img.alt = ((Alarm_On)?L_Alarm_Disable_Alt:L_Alarm_Enable_Alt);
}

//************************************************************************
// evento cmdAlarm_fwd_onclick 
// - Disparado durante click no botão Próximo Alarme, exibe o proximo
//   alarme do array configurado.
//************************************************************************
function cmdAlarm_fwd_onclick()
{
	if (Alarms_Array_CurrIndex < Alarms_Array.length)
	{
		Alarms_Array_CurrIndex += 1;
	}
	else
	{
		Alarms_Array_CurrIndex = 0;
	}
	Show_Alarm();
}

//************************************************************************
// evento cmdAlarm_rwd_onclick 
// - Disparado durante click no botão Alarme Anterior, exibe o alarme
//   anterior, no array configurado.
//************************************************************************
function cmdAlarm_rwd_onclick()
{
	if (Alarms_Array_CurrIndex <= 0)
	{
		Alarms_Array_CurrIndex = Alarms_Array.length - 1;
	}
	else
	{
		Alarms_Array_CurrIndex -= 1;
	}
	Show_Alarm();
}

function lblAlarm_id_onclick()
{
}


//************************************************************************
// evento gadget_onDock
//************************************************************************
function gadget_onDock()
{
    Setup_Properties();
    Config_Images();
    Config_Sizes();
    Config_Pos();
}

//************************************************************************
// evento gadget_onUndock
//************************************************************************
function gadget_onUndock()
{
    Setup_Properties();
    Config_Images();
    Config_Sizes();
    Config_Pos();
}


//************************************************************************
// evento gadget_onSettingsClosed
//************************************************************************
function gadget_onSettingsClosed()
{
	Load_Settings();
	Set_Texts();
	Config_Images();
}

//************************************************************************
// função Load_Settings
// - Carrega os valores das configurações do gadget.
//************************************************************************
function Load_Settings()
{
	// Deserializa a array de alarmes.
	while (Alarms_Array.length > 0)
    {
        Alarms_Array.pop();
    }
	
	if (System.Gadget.Settings.readString("Alarms") != "")
	{
		var Alarms_Text;
		Alarms_Text = System.Gadget.Settings.readString("Alarms");
		var Elements;
		Elements = Alarms_Text.split(";");

		// Carrega os itens na Array
		for (var x = 0; x < Elements.length; x++)
		{
			var Element = Elements[x];
			Alarms_Array.push(Element);
		}
	}

	// Carrega configurações
	if (System.Gadget.Settings.readString("Show_Seconds") != "")
	{
		Show_Seconds = (System.Gadget.Settings.readString("Show_Seconds") == "1")?true:false;
	}
	else
	{
		Show_Seconds = true;
	}
	
	if (System.Gadget.Settings.readString("Show_AMPM") != "")
	{
		Show_AMPM = (System.Gadget.Settings.readString("Show_AMPM") == "1")?true:false;
	}
	else
	{
		Show_AMPM = false;
	}

	if (System.Gadget.Settings.readString("Alarm_File") != "")
	{
		Alarm_File = System.Gadget.Settings.readString("Alarm_File");
	}
	else
	{
		Alarm_File = "res/alarm.wav";
	}
	
	if (System.Gadget.Settings.readString("CurrSkin") == "")
	{
		CurrentSkin = 3;
	}
	else
	{
		CurrentSkin = Math.floor(System.Gadget.Settings.readString("CurrSkin"));
	}

	Alarms_Array_CurrIndex = 0;
	Show_Alarm();
}

// A partir do alarm index, exibe um valor de alarme
function Show_Alarm()
{
	if (Alarms_Array_CurrIndex >= Alarms_Array.length)
	{
		Alarms_Array_CurrIndex = 0;
		Alarm_id.innerText = L_Alarm + (Alarms_Array_CurrIndex + 1) + "/" + Alarms_Array.length;
	}
	
	if (Alarms_Array.length == 0)
	{
		lblAlarm.innerText = "__:__";
		Alarm_id.innerText = L_NoAlarm;
	}
	else
	{
		lblAlarm.innerText = Alarms_Array[Alarms_Array_CurrIndex];
		Alarm_id.innerText = L_Alarm + (Alarms_Array_CurrIndex + 1) + "/" + Alarms_Array.length;
	}
}

//************************************************************************
// função Setup_Properties
// - Define valores das propriedades do gadget (p.e: docked)
//************************************************************************
function Setup_Properties()
{

    IsDocked = System.Gadget.docked;
    IsFlyOuted = System.Gadget.Flyout.show;    
    
    if (IsDocked)
    {
        GadgetStyle.href = "css/docked.css";
    }
    else
    {
        GadgetStyle.href = "css/undocked.css";
    }
    
    CurrResourceFolder = ((IsDocked)?"images/docked/":"images/undocked/");
    
    System.Gadget.settingsUI = "settings.htm";
    System.Gadget.Flyout.file = "flyout.htm";
    
}



//************************************************************************
// função Config_Images
// - Define as imagens dos elementos do gadget
//************************************************************************
function Config_Images()
{
	// Carrega o fundo de acordo com o estado (docked/undocked) e de acordo
	// com a skin atual.
    if (IsDocked)
    {
        System.Gadget.background = "url(" + CurrResourceFolder + Skin_Backs[CurrentSkin] + ")";
    }
    else
    {
        System.Gadget.background = "url(" + CurrResourceFolder + Skin_Backs[CurrentSkin] + ")";
    }
    
    frmBack.src = System.Gadget.background;
    img_Shine.src = CurrResourceFolder + "shine.png";
    Alarm_img.src = CurrResourceFolder + "alarm_0.png";
    Alarm_fwd.src = CurrResourceFolder + "right.png";
    Alarm_rwd.src = CurrResourceFolder + "left.png";
    
    // Altera a pasta da imagem atual do messagebox
    if (ErrorIcon.src.indexOf("info.png") > 0)
    {
    	ErrorIcon.src = CurrResourceFolder + "info.png";
    }
    else
    {
    	ErrorIcon.src = CurrResourceFolder + "error.png";
    }
    
}


//************************************************************************
// função Config_Pos
// - Configura as posições dos elementos do gadget.
//************************************************************************
function Config_Pos()
{
    frmBack.style.left                  =   0;
    frmBack.style.top                   =   0;

    if (IsDocked)
    {
    	// Update 2007.02.16 - Rogério
    	// Todos as configurações de posicionamento foram movidas para
    	// os CSS correspondentes.
    }
    else
    {
    }
}

//************************************************************************
// função Config_Sizes
// - Configura as dimensões do gadget e seus elementos.
//************************************************************************
function Config_Sizes()
{

    if (IsDocked)
    {
        document.body.style.width       =   Gadget_Size_D.width;
        document.body.style.height      =   Gadget_Size_D.height;

        frmBack.style.width             =   Gadget_Size_D.width;
        frmBack.style.height            =   Gadget_Size_D.height;        
    }
    else
    {
        document.body.style.width       =   Gadget_Size_U.width;
        document.body.style.height      =   Gadget_Size_U.height;

        frmBack.style.width             =   Gadget_Size_U.width;
        frmBack.style.height            =   Gadget_Size_U.height;       
    }
}

