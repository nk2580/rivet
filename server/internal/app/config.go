package app

import (
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
)

const OwnerEmail = "owner@example.test"

type FirebaseWebConfig struct {
	APIKey     string `json:"apiKey"`
	AuthDomain string `json:"authDomain"`
	ProjectID  string `json:"projectId"`
	AppID      string `json:"appId"`
}
type PublicConfig struct {
	Mode                  string            `json:"mode"`
	Configured            bool              `json:"configured"`
	Firebase              FirebaseWebConfig `json:"firebase"`
	AuthEmulatorURL       string            `json:"authEmulatorUrl,omitempty"`
	FirestoreEmulatorHost string            `json:"firestoreEmulatorHost,omitempty"`
	FirestoreEmulatorPort int               `json:"firestoreEmulatorPort,omitempty"`
}
type Config struct {
	Listen             string
	Origins            []string
	Public             PublicConfig
	ServiceAccountJSON []byte
}

func ConfigFromEnvironment() (Config, error) {
	mode := os.Getenv("RIVET_AUTH_MODE")
	if mode == "" {
		mode = "connected"
	}
	if mode != "connected" && mode != "emulator" {
		return Config{}, errors.New("RIVET_AUTH_MODE must be connected or emulator")
	}
	cfg := Config{Listen: ":8080", Origins: strings.Split(envOr("RIVET_APP_ORIGINS", "http://localhost:8088,http://localhost:5173,http://127.0.0.1:5173"), ","), Public: PublicConfig{Mode: mode}, ServiceAccountJSON: []byte(os.Getenv("FIREBASE_SERVICE_ACCOUNT_JSON"))}
	if port := os.Getenv("PORT"); port != "" {
		cfg.Listen = ":" + port
	}
	cfg.Public.Firebase = FirebaseWebConfig{APIKey: os.Getenv("FIREBASE_WEB_API_KEY"), AuthDomain: os.Getenv("FIREBASE_AUTH_DOMAIN"), ProjectID: os.Getenv("FIREBASE_PROJECT_ID"), AppID: os.Getenv("FIREBASE_WEB_APP_ID")}
	if raw := os.Getenv("FIREBASE_WEB_CONFIG"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &cfg.Public.Firebase); err != nil {
			return Config{}, errors.New("FIREBASE_WEB_CONFIG is not valid public web configuration JSON")
		}
	}
	if mode == "emulator" {
		if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") == "" || os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
			return Config{}, errors.New("emulator mode requires both Firebase emulator hosts")
		}
		if cfg.Public.Firebase.ProjectID != "" && !strings.HasPrefix(cfg.Public.Firebase.ProjectID, "demo-") {
			return Config{}, errors.New("emulator mode requires a demo- project ID")
		}
		cfg.Public.Firebase = FirebaseWebConfig{APIKey: "demo-rivet-public-key", AuthDomain: "demo-rivet.firebaseapp.com", ProjectID: "demo-rivet", AppID: "demo-rivet-web"}
		cfg.Public.AuthEmulatorURL = envOr("RIVET_PUBLIC_AUTH_EMULATOR_URL", "http://localhost:9099")
		cfg.Public.FirestoreEmulatorHost = envOr("RIVET_PUBLIC_FIRESTORE_EMULATOR_HOST", "localhost")
		cfg.Public.FirestoreEmulatorPort = 8081
		if port := os.Getenv("RIVET_PUBLIC_FIRESTORE_EMULATOR_PORT"); port != "" {
			parsed, err := strconv.Atoi(port)
			if err != nil || parsed < 1 || parsed > 65535 {
				return Config{}, errors.New("invalid public Firestore emulator port")
			}
			cfg.Public.FirestoreEmulatorPort = parsed
		}
	} else if os.Getenv("FIREBASE_AUTH_EMULATOR_HOST") != "" || os.Getenv("FIRESTORE_EMULATOR_HOST") != "" {
		return Config{}, errors.New("connected mode must not use Firebase emulator hosts")
	}
	f := cfg.Public.Firebase
	cfg.Public.Configured = f.APIKey != "" && f.AuthDomain != "" && f.ProjectID != "" && f.AppID != ""
	return cfg, nil
}
func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
