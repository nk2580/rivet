package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

type VerifyToken func(context.Context, string) (*auth.Token, error)
type Server struct {
	cfg    Config
	verify VerifyToken
	mux    *http.ServeMux
}

func New(ctx context.Context, cfg Config) (*Server, error) {
	var verify VerifyToken
	if cfg.Public.Configured {
		options := []option.ClientOption{option.WithoutAuthentication()}
		if len(cfg.ServiceAccountJSON) > 0 {
			options = []option.ClientOption{option.WithCredentialsJSON(cfg.ServiceAccountJSON)}
		}
		application, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: cfg.Public.Firebase.ProjectID}, options...)
		if err != nil {
			return nil, errors.New("Firebase administration client could not be initialized")
		}
		client, err := application.Auth(ctx)
		if err != nil {
			return nil, errors.New("Firebase authentication verifier could not be initialized")
		}
		verify = client.VerifyIDToken
	}
	return NewWithVerifier(cfg, verify), nil
}

func NewWithVerifier(cfg Config, verify VerifyToken) *Server {
	s := &Server{cfg: cfg, verify: verify, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "rivet-api", "mode": cfg.Public.Mode, "identityConfigured": cfg.Public.Configured})
	})
	s.mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, cfg.Public)
	})
	s.mux.Handle("GET /api/v1/account", s.authorize(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"email": OwnerEmail})
	})))
	return s
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if origin != "" {
			allowed := false
			for _, candidate := range s.cfg.Origins {
				if origin == strings.TrimSpace(candidate) {
					allowed = true
					break
				}
			}
			if !allowed {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1024*1024)
		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.verify == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "identity_not_configured"})
			return
		}
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") || len(header) <= 7 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sign_in_required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		token, err := s.verify(ctx, strings.TrimPrefix(header, "Bearer "))
		if err != nil || !isOwner(token) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "account_not_allowed"})
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ownerUIDKey{}, token.UID)))
	})
}

type ownerUIDKey struct{}

func isOwner(token *auth.Token) bool {
	if token == nil || token.UID == "" {
		return false
	}
	email, _ := token.Claims["email"].(string)
	verified, _ := token.Claims["email_verified"].(bool)
	return email == OwnerEmail && verified && token.Firebase.SignInProvider == "google.com"
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
