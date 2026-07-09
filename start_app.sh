#!/bin/bash
# TE Connectivity Post-Merger Integration Portal - macOS/Linux Startup Runner
# Fired up with pair-programming care.

echo "=========================================================="
echo "   TE Connectivity Post-Merger Integration IMO System     "
echo "=========================================================="
echo ""

# Navigate to project directory
cd "$(dirname "$0")"

# Validate if node is installed
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "Node.js or npm is not installed or not in PATH. Attempting a fully automated local installation..."
    
    # Create bin directory for local binaries if not present
    mkdir -p bin
    
    # Detect Architecture
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
        NODE_ARCH="darwin-arm64"
    else
        NODE_ARCH="darwin-x64"
    fi
    
    NODE_VERSION="20.11.1"
    NODE_DIR="node-v${NODE_VERSION}-${NODE_ARCH}"
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIR}.tar.gz"
    
    echo "--> Downloading precompiled Node.js binary (${NODE_DIR})..."
    # Download tarball directly and extract it to bin/
    curl -L "$NODE_URL" | tar -xz -C bin/
    
    if [ $? -eq 0 ] && [ -d "bin/${NODE_DIR}" ]; then
        echo "--> Local Node.js extracted successfully."
        # Export PATH for current session
        export PATH="$(pwd)/bin/${NODE_DIR}/bin:$PATH"
        echo "--> Added local Node.js to session PATH."
    else
        echo "--> Automated extraction failed. Attempting Homebrew fallback..."
        if command -v brew &> /dev/null; then
            brew install node
        else
            echo "--> Homebrew not found. Falling back to official installer..."
            PKG_NAME="node-v${NODE_VERSION}.pkg"
            URL="https://nodejs.org/dist/v${NODE_VERSION}/${PKG_NAME}"
            curl -L -o "bin/${PKG_NAME}" "${URL}"
            echo "Opening official Node.js installer. Please follow the wizard instructions..."
            open "bin/${PKG_NAME}"
            echo "=========================================================="
            echo "Please complete the Node.js installation and then restart"
            echo "this terminal window and run ./start_app.sh again."
            echo "=========================================================="
            exit 1
        fi
    fi
fi

echo "--> Synchronizing Node.js dependencies..."
npm install --no-audit --no-fund

echo "--> Initializing local Express server..."
# Start server in the background and record PID
node server.js &
SERVER_PID=$!

# Let the server bind to the port
sleep 1.5

echo "--> Launching your default browser..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:3000"
else
    # Linux browser launcher
    xdg-open "http://localhost:3000" || sensible-browser "http://localhost:3000" || x-www-browser "http://localhost:3000"
fi

echo ""
echo "Portal is now running live at http://localhost:3000!"
echo "To terminate the server, press [Ctrl + C] in this window."
echo "=========================================================="

# Keep process alive and bound to terminal
wait $SERVER_PID
