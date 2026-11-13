// rcs-bridge: Dreamscape's link to Google Messages (Yozora #779).
//
// The server (modules/textMessagingRcs.js) runs this program and talks to it in JSON lines over
// stdin / stdout. It pairs with Google Messages on the phone as a "Messages for web" client
// (go.mau.fi/mautrix-gmessages/pkg/libgm), so RCS keeps working with Google Messages as the
// phone's default app, and reads and sends through the phone.
//
//   rcs-bridge <state dir>        session.json lives there (0600)
//
// In:  {"id":1,"cmd":"status","args":{...}}
// Out: {"id":1,"ok":true,"result":...} | {"id":1,"ok":false,"error":"..."}
//      {"event":"qr"|"paired"|"message"|"conversation"|"typing"|"settings"|"state"|"logged_out","data":...}
//
// Protos leave as protojson (field names as in gmproto); the server normalizes them.
// Commands: status, login, logout, conversations, conversation, messages, send, react, delete,
// markRead, typing, download, newChat, contacts.
package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/util/exhttp"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"go.mau.fi/mautrix-gmessages/pkg/libgm"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/events"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"
)

type request struct {
	ID   int64           `json:"id"`
	Cmd  string          `json:"cmd"`
	Args json.RawMessage `json:"args"`
}

var (
	outMu     sync.Mutex
	stateDir  string
	sessMu    sync.Mutex
	sess      *libgm.AuthData
	cli       *libgm.Client
	log       zerolog.Logger
	lastSIM   *gmproto.SIMCard
	phoneID   string
	connected bool
	pjson     = protojson.MarshalOptions{UseProtoNames: false, EmitUnpopulated: false}
)

func emit(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	outMu.Lock()
	os.Stdout.Write(append(b, '\n'))
	outMu.Unlock()
}

func protoRaw(m proto.Message) json.RawMessage {
	if m == nil {
		return json.RawMessage("null")
	}
	b, err := pjson.Marshal(m)
	if err != nil {
		return json.RawMessage("null")
	}
	return b
}

func event(name string, data any) { emit(map[string]any{"event": name, "data": data}) }

func sessionFile() string { return filepath.Join(stateDir, "session.json") }

func saveSession() {
	sessMu.Lock()
	defer sessMu.Unlock()
	if sess == nil {
		return
	}
	b, err := json.Marshal(sess)
	if err != nil {
		return
	}
	tmp := sessionFile() + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err == nil {
		_ = os.Rename(tmp, sessionFile())
	}
}

func loadSession() bool {
	b, err := os.ReadFile(sessionFile())
	if err != nil {
		sess = libgm.NewAuthData()
		return false
	}
	sess = libgm.NewAuthData()
	if err := json.Unmarshal(b, sess); err != nil {
		sess = libgm.NewAuthData()
		return false
	}
	return sess.Browser != nil || sess.TachyonAuthToken != nil
}

func newClient() {
	cli = libgm.NewClient(sess, nil, log, exhttp.SensibleClientSettings)
	cli.SetEventHandler(onEvent)
}

func state(extra map[string]any) {
	d := map[string]any{"loggedIn": cli != nil && cli.IsLoggedIn(), "connected": connected, "phoneId": phoneID}
	for k, v := range extra {
		d[k] = v
	}
	event("state", d)
}

func onEvent(raw any) {
	switch evt := raw.(type) {
	case *events.QR:
		event("qr", map[string]any{"url": evt.URL})
	case *events.PairSuccessful:
		phoneID = evt.PhoneID
		saveSession()
		event("paired", map[string]any{"phoneId": evt.PhoneID})
		// a QR pairing needs a fresh connection with the new tokens
		go func() {
			time.Sleep(2 * time.Second)
			cli.Disconnect()
			newClient()
			if err := cli.Connect(context.Background()); err != nil {
				state(map[string]any{"error": err.Error()})
				return
			}
			connected = true
			state(nil)
		}()
	case *libgm.WrappedMessage:
		event("message", map[string]any{"isOld": evt.IsOld, "message": protoRaw(evt.Message)})
	case *gmproto.Conversation:
		event("conversation", protoRaw(evt))
	case *gmproto.TypingData:
		event("typing", protoRaw(evt))
	case *gmproto.Settings:
		if sims := evt.GetSIMCards(); len(sims) > 0 {
			lastSIM = sims[0]
		}
		event("settings", protoRaw(evt))
	case *events.AuthTokenRefreshed:
		saveSession()
	case *events.PhoneNotResponding:
		state(map[string]any{"phoneResponding": false})
	case *events.PhoneRespondingAgain:
		state(map[string]any{"phoneResponding": true})
	case *events.BrowserActive:
		// another Messages for web session took over; ours goes passive until we ask again
		state(map[string]any{"browserActiveElsewhere": true})
	case *events.ListenFatalError:
		connected = false
		state(map[string]any{"error": evt.Error.Error(), "fatal": true})
	case *events.ListenTemporaryError:
		state(map[string]any{"error": evt.Error.Error()})
	case *events.ListenRecovered:
		connected = true
		state(map[string]any{"error": ""})
	case *events.GaiaLoggedOut:
		connected = false
		event("logged_out", nil)
	case *gmproto.RevokePairData:
		connected = false
		sess.ClearPairing()
		saveSession()
		event("logged_out", nil)
	case *gmproto.UserAlertEvent:
		event("alert", protoRaw(evt))
	}
}

// ---- commands ----

func simFor(conv *gmproto.Conversation) *gmproto.SIMPayload {
	if conv != nil && conv.GetSimCard() != nil {
		return conv.GetSimCard().GetSIMData().GetSIMPayload()
	}
	if lastSIM != nil {
		return lastSIM.GetSIMData().GetSIMPayload()
	}
	return nil
}

func folderOf(name string) gmproto.ListConversationsRequest_Folder {
	switch name {
	case "archive":
		return gmproto.ListConversationsRequest_ARCHIVE
	case "spam":
		return gmproto.ListConversationsRequest_SPAM_BLOCKED
	}
	return gmproto.ListConversationsRequest_INBOX
}

func requireLogin() error {
	if cli == nil || !cli.IsLoggedIn() {
		return errors.New("NOT_PAIRED: Google Messages is not paired")
	}
	return nil
}

func handle(ctx context.Context, r request) (any, error) {
	var a map[string]any
	if len(r.Args) > 0 {
		_ = json.Unmarshal(r.Args, &a)
	}
	str := func(k string) string { s, _ := a[k].(string); return s }
	num := func(k string, def int64) int64 {
		if f, ok := a[k].(float64); ok && f > 0 {
			return int64(f)
		}
		return def
	}
	switch r.Cmd {
	case "status":
		return map[string]any{"loggedIn": cli != nil && cli.IsLoggedIn(), "connected": connected, "phoneId": phoneID}, nil
	case "login":
		if cli != nil {
			cli.Disconnect()
		}
		sess = libgm.NewAuthData()
		newClient()
		url, err := cli.StartLogin(ctx)
		if err != nil {
			return nil, err
		}
		event("qr", map[string]any{"url": url})
		return map[string]any{"qr": url}, nil
	case "refreshQr":
		if cli == nil {
			return nil, errors.New("no login in progress")
		}
		url, err := cli.RefreshPhoneRelay()
		if err != nil {
			return nil, err
		}
		event("qr", map[string]any{"url": url})
		return map[string]any{"qr": url}, nil
	case "logout":
		if cli != nil {
			_ = cli.Unpair(ctx)
			cli.Disconnect()
		}
		sess = libgm.NewAuthData()
		_ = os.Remove(sessionFile())
		connected = false
		newClient()
		return map[string]any{"ok": true}, nil
	}
	if err := requireLogin(); err != nil {
		return nil, err
	}
	switch r.Cmd {
	case "conversations":
		req := &gmproto.ListConversationsRequest{Count: num("count", 50), Folder: folderOf(str("folder"))}
		if c := str("cursor"); c != "" {
			cur := &gmproto.Cursor{}
			if err := protojson.Unmarshal([]byte(c), cur); err == nil {
				req.Cursor = cur
			}
		}
		res, err := cli.ListConversations(ctx, req)
		if err != nil {
			return nil, err
		}
		return protoRaw(res), nil
	case "conversation":
		res, err := cli.GetConversation(ctx, str("conversationId"))
		if err != nil {
			return nil, err
		}
		return protoRaw(res), nil
	case "messages":
		var cur *gmproto.Cursor
		if c := str("cursor"); c != "" {
			cur = &gmproto.Cursor{}
			if err := protojson.Unmarshal([]byte(c), cur); err != nil {
				cur = nil
			}
		}
		res, err := cli.FetchMessages(ctx, str("conversationId"), num("count", 50), cur)
		if err != nil {
			return nil, err
		}
		return protoRaw(res), nil
	case "send":
		convID := str("conversationId")
		conv, err := cli.GetConversation(ctx, convID)
		if err != nil {
			return nil, fmt.Errorf("conversation: %w", err)
		}
		tmp := str("tmpId")
		if tmp == "" {
			tmp = fmt.Sprintf("tmp_%d", time.Now().UnixNano())
		}
		req := &gmproto.SendMessageRequest{
			ConversationID: convID,
			MessagePayload: &gmproto.MessagePayload{TmpID: tmp, ConversationID: convID, ParticipantID: conv.GetDefaultOutgoingID(), TmpID2: tmp},
			SIMPayload:     simFor(conv),
			TmpID:          tmp,
		}
		if rt := str("replyTo"); rt != "" && conv.GetType() == gmproto.ConversationType_RCS {
			req.Reply = &gmproto.ReplyPayload{MessageID: rt}
		}
		var infos []*gmproto.MessageInfo
		if p := str("filePath"); p != "" {
			data, err := os.ReadFile(p)
			if err != nil {
				return nil, err
			}
			media, err := cli.UploadMedia(data, str("fileName"), str("mime"))
			if err != nil {
				return nil, fmt.Errorf("upload: %w", err)
			}
			infos = append(infos, &gmproto.MessageInfo{Data: &gmproto.MessageInfo_MediaContent{MediaContent: media}})
		}
		if t := str("text"); t != "" {
			infos = append(infos, &gmproto.MessageInfo{Data: &gmproto.MessageInfo_MessageContent{MessageContent: &gmproto.MessageContent{Content: t}}})
		}
		if len(infos) == 0 {
			return nil, errors.New("nothing to send")
		}
		req.MessagePayload.MessageInfo = infos
		res, err := cli.SendMessage(ctx, req)
		if err != nil {
			return nil, err
		}
		return map[string]any{"tmpId": tmp, "response": protoRaw(res)}, nil
	case "react":
		action := gmproto.SendReactionRequest_ADD
		switch str("action") {
		case "remove":
			action = gmproto.SendReactionRequest_REMOVE
		case "switch":
			action = gmproto.SendReactionRequest_SWITCH
		}
		var conv *gmproto.Conversation
		if id := str("conversationId"); id != "" {
			conv, _ = cli.GetConversation(ctx, id)
		}
		res, err := cli.SendReaction(ctx, &gmproto.SendReactionRequest{
			MessageID: str("messageId"), ReactionData: gmproto.MakeReactionData(str("emoji")), Action: action, SIMPayload: simFor(conv),
		})
		if err != nil {
			return nil, err
		}
		return protoRaw(res), nil
	case "delete":
		res, err := cli.DeleteMessage(ctx, str("messageId"))
		if err != nil {
			return nil, err
		}
		return protoRaw(res), nil
	case "markRead":
		if err := cli.MarkRead(ctx, str("conversationId"), str("messageId")); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	case "typing":
		conv, _ := cli.GetConversation(ctx, str("conversationId"))
		if err := cli.SetTyping(ctx, str("conversationId"), simFor(conv)); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	case "download":
		key, err := base64.StdEncoding.DecodeString(str("key"))
		if err != nil {
			return nil, fmt.Errorf("key: %w", err)
		}
		rc, err := cli.DownloadMedia(str("mediaId"), key)
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		out := str("path")
		f, err := os.OpenFile(out+".part", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
		if err != nil {
			return nil, err
		}
		n, err := io.Copy(f, rc)
		f.Close()
		if err != nil {
			_ = os.Remove(out + ".part")
			return nil, err
		}
		if err := os.Rename(out+".part", out); err != nil {
			return nil, err
		}
		return map[string]any{"path": out, "size": n}, nil
	case "newChat":
		var nums []*gmproto.ContactNumber
		if list, ok := a["numbers"].([]any); ok {
			for _, v := range list {
				if s, ok := v.(string); ok && s != "" {
					nums = append(nums, &gmproto.ContactNumber{MysteriousInt: 2, Number: s, Number2: s})
				}
			}
		}
		if len(nums) == 0 {
			return nil, errors.New("no numbers")
		}
		req := &gmproto.GetOrCreateConversationRequest{Numbers: nums}
		if n := str("name"); n != "" {
			req.RCSGroupName = &n
		}
		res, err := cli.GetOrCreateConversation(ctx, req)
		if err != nil {
			return nil, err
		}
		return protoRaw(res), nil
	case "contacts":
		res, err := cli.ListContacts(ctx)
		if err != nil {
			return nil, err
		}
		return protoRaw(res), nil
	}
	return nil, fmt.Errorf("unknown command %q", r.Cmd)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: rcs-bridge <state dir>")
		os.Exit(2)
	}
	stateDir = os.Args[1]
	_ = os.MkdirAll(stateDir, 0700)
	log = zerolog.New(os.Stderr).With().Timestamp().Logger().Level(zerolog.InfoLevel)

	paired := loadSession()
	newClient()
	if paired {
		go func() {
			if err := cli.Connect(context.Background()); err != nil {
				state(map[string]any{"error": err.Error()})
				return
			}
			connected = true
			state(nil)
		}()
	} else {
		state(nil)
	}

	scan := bufio.NewScanner(os.Stdin)
	scan.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for scan.Scan() {
		var r request
		if err := json.Unmarshal(scan.Bytes(), &r); err != nil {
			continue
		}
		go func(r request) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			res, err := handle(ctx, r)
			if err != nil {
				emit(map[string]any{"id": r.ID, "ok": false, "error": err.Error()})
				return
			}
			emit(map[string]any{"id": r.ID, "ok": true, "result": res})
		}(r)
	}
	saveSession()
	if cli != nil {
		cli.Disconnect()
	}
}
