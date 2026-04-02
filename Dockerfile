FROM heroiclabs/nakama:3.22.0

# Copy your compiled game logic
COPY build /nakama/data/modules

# Copy config
COPY local.yml /nakama/data/local.yml

# Start Nakama (Railway will override DB via env)
CMD ["/nakama/nakama", "--config", "/nakama/data/local.yml"]