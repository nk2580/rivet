package app

import (
	"context"
	"errors"
	"firebase.google.com/go/v4/auth"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testToken(email string, verified bool, provider string) *auth.Token {
	token := &auth.Token{UID: "owner-uid", Claims: map[string]interface{}{"email": email, "email_verified": verified}}
	token.Firebase.SignInProvider = provider
	return token
}
func TestOwnerBoundary(t *testing.T) {
	for _, test := range []struct {
		name    string
		token   *auth.Token
		invalid bool
		want    int
	}{
		{"verified google owner", testToken(OwnerEmail, true, "google.com"), false, 200},
		{"other google user", testToken("other@example.com", true, "google.com"), false, 403},
		{"unverified email", testToken(OwnerEmail, false, "google.com"), false, 403},
		{"password owner", testToken(OwnerEmail, true, "password"), false, 403},
		{"invalid token", nil, true, 403},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := NewWithVerifier(Config{Origins: []string{"https://rivet.example"}}, func(context.Context, string) (*auth.Token, error) {
				if test.invalid {
					return nil, errors.New("invalid")
				}
				return test.token, nil
			})
			request := httptest.NewRequest("GET", "/api/v1/account", nil)
			request.Header.Set("Authorization", "Bearer test-fixture")
			recorder := httptest.NewRecorder()
			s.Handler().ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("got %d, want %d", recorder.Code, test.want)
			}
		})
	}
}
func TestNoTokenAndCrossOriginDenied(t *testing.T) {
	s := NewWithVerifier(Config{Origins: []string{"https://rivet.example"}}, func(context.Context, string) (*auth.Token, error) {
		return testToken(OwnerEmail, true, "google.com"), nil
	})
	for _, origin := range []string{"", "https://attacker.example"} {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/account", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != 401 && w.Code != 403 {
			t.Fatalf("request allowed: %d", w.Code)
		}
	}
}
func TestConnectedModeRejectsEmulatorConfiguration(t *testing.T) {
	t.Setenv("RIVET_AUTH_MODE", "connected")
	t.Setenv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099")
	if _, err := ConfigFromEnvironment(); err == nil {
		t.Fatal("connected mode accepted emulator identity verifier")
	}
}
