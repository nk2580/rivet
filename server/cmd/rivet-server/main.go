package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"rivet/server/internal/app"
	"syscall"
	"time"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}
		client := &http.Client{Timeout: 3 * time.Second}
		response, err := client.Get("http://127.0.0.1:" + port + "/api/health")
		if err != nil {
			os.Exit(1)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		return
	}
	cfg, err := app.ConfigFromEnvironment()
	if err != nil {
		slog.Error("configuration invalid", "reason", err.Error())
		os.Exit(1)
	}
	server, err := app.New(context.Background(), cfg)
	if err != nil {
		slog.Error("startup failed", "reason", err.Error())
		os.Exit(1)
	}
	httpServer := &http.Server{Addr: cfg.Listen, Handler: server.Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 90 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()
	slog.Info("Rivet API listening", "address", cfg.Listen, "mode", cfg.Public.Mode, "identityConfigured", cfg.Public.Configured)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server stopped", "reason", err.Error())
		os.Exit(1)
	}
}
