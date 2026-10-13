(function (globalScope) {
  "use strict";

  const MAX_TRANSFER_BYTES = 1000000;
  const MAX_TRANSFER_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_DIRECT_SIGNAL_CHARACTERS = 20000;
  const DIRECT_DATA_CHUNK_SIZE = 12000;
  const DIRECT_CONNECTION_TIMEOUT_MS = 45000;
  const FRAME_CHUNK_SIZE = 700;
  const FRAME_INTERVAL_MS = 500;
  const MAX_SCAN_WIDTH = 720;
  const SCAN_INTERVAL_MS = 100;
  const MAX_FRAME_COUNT = Math.ceil(
    (MAX_TRANSFER_BYTES * 4) / 3 / FRAME_CHUNK_SIZE,
  );
  const QR_LIBRARIES = [
    {
      name: "qrcode",
      src: "qr-vendor/qrcode-generator.js",
    },
    {
      name: "jsQR",
      src: "qr-vendor/jsQR.js",
    },
  ];

  let frameTimer = 0;
  let frameIndex = 0;
  let frameGeneration = 0;
  let scannerFrame = 0;
  let scannerGeneration = 0;
  let lastScanAt = 0;
  let modalGeneration = 0;
  let cameraStream = null;
  let libraryPromise = null;
  let importInFlight = false;
  let modalKeydownHandler = null;
  let pendingImport = null;
  let receivedFrames = null;
  let fileImportGeneration = 0;
  let directGeneration = 0;
  let directRole = null;
  let directPhase = null;
  let directPeer = null;
  let directChannel = null;
  let directReceive = null;
  let directTransferId = null;
  let directConnectionTimer = 0;

  function getElement(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function setStatus(message, isError = false) {
    const status = getElement("qr-transfer-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("hidden", !message);
    status.classList.toggle("text-red-600", isError);
    status.classList.toggle("dark:text-red-300", isError);
    status.setAttribute("role", isError ? "alert" : "status");
  }

  function showPanel(panelId) {
    for (const id of [
      "qr-transfer-home",
      "qr-transfer-export",
      "qr-transfer-scan",
      "qr-transfer-import",
      "qr-transfer-done",
      "qr-transfer-direct",
      "qr-transfer-direct-wait",
    ]) {
      getElement(id)?.classList.toggle("hidden", id !== panelId);
    }
  }

  function setDirectStatus(message, isError = false) {
    setStatus(message, isError);
    for (const id of [
      "qr-transfer-direct-status",
      "qr-transfer-direct-wait-status",
    ]) {
      const status = getElement(id);
      if (!status) continue;
      status.textContent = message;
      status.classList.toggle("text-red-600", isError);
      status.classList.toggle("dark:text-red-300", isError);
    }
  }

  function renderDirectSignal(description, role) {
    const signal = createDirectSignal(description);
    const image = getElement("qr-transfer-direct-image");
    const code = getElement("qr-transfer-direct-code");
    if (code) code.value = signal;
    if (image && globalScope.qrcode) {
      try {
        const qr = globalScope.qrcode(0, "L");
        qr.addData(signal);
        qr.make();
        image.src = qr.createDataURL(4, 8);
        image.alt = `Direct transfer ${description.type} connection QR code`;
        image.classList.remove("hidden");
      } catch {
        image.removeAttribute("src");
        image.classList.add("hidden");
      }
    }
    const scanButton = getElement("qr-transfer-direct-scan-answer");
    if (scanButton) scanButton.classList.toggle("hidden", role !== "sender");
    const heading = getElement("qr-transfer-direct-heading");
    if (heading) {
      heading.textContent =
        role === "sender"
          ? "Scan this code on the receiving device"
          : "Scan this response on the sending device";
    }
    showPanel("qr-transfer-direct");
    setDirectStatus(
      image?.classList.contains("hidden")
        ? "The code is too large for one QR image. Copy it and enter it on the other device."
        : "Scan this short code on the other device. Progress is sent only after the devices connect.",
    );
  }

  async function copyDirectSignal() {
    const code = getElement("qr-transfer-direct-code");
    if (!code?.value) {
      setDirectStatus("There is no connection code to copy.", true);
      return;
    }
    try {
      await globalScope.navigator.clipboard.writeText(code.value);
      setDirectStatus("Connection code copied.");
    } catch (error) {
      setDirectStatus(
        error.message || "Unable to copy the connection code.",
        true,
      );
    }
  }

  function createDirectPeer(role, generation) {
    if (typeof globalScope.RTCPeerConnection !== "function") {
      throw new Error(
        "Direct transfer is not supported in this browser. Use a transfer file instead.",
      );
    }
    directRole = role;
    const peer = new globalScope.RTCPeerConnection({ iceServers: [] });
    directPeer = peer;
    peer.onconnectionstatechange = () => {
      if (generation !== directGeneration) return;
      if (peer.connectionState === "failed") {
        globalScope.clearTimeout(directConnectionTimer);
        directConnectionTimer = 0;
        setDirectStatus(
          "A direct connection could not be made. Check that both devices are on the same Wi-Fi, then try again or use a transfer file.",
          true,
        );
      } else if (peer.connectionState === "connected") {
        globalScope.clearTimeout(directConnectionTimer);
        directConnectionTimer = 0;
        setDirectStatus("Direct encrypted connection established.");
      }
    };
    if (role === "sender") {
      directChannel = peer.createDataChannel("mrh-progress-transfer", {
        ordered: true,
      });
      configureDirectChannel(directChannel, role, generation);
    } else {
      peer.ondatachannel = (event) => {
        if (generation !== directGeneration) {
          event.channel.close();
          return;
        }
        directChannel = event.channel;
        configureDirectChannel(directChannel, role, generation);
      };
    }
    return peer;
  }

  function armDirectConnectionTimeout(generation) {
    globalScope.clearTimeout(directConnectionTimer);
    directConnectionTimer = globalScope.setTimeout(() => {
      if (generation !== directGeneration) return;
      setDirectStatus(
        "The direct connection timed out. Check that both devices are on the same Wi-Fi and try again, or use a transfer file.",
        true,
      );
      cleanupDirect();
    }, DIRECT_CONNECTION_TIMEOUT_MS);
  }

  function waitForIceGathering(peer, generation) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timeout = 0;
      const finish = (error) => {
        globalScope.clearTimeout(timeout);
        peer.removeEventListener("icegatheringstatechange", onStateChange);
        if (error) reject(error);
        else resolve();
      };
      const onStateChange = () => {
        if (generation !== directGeneration) {
          finish(new Error("Direct transfer was cancelled."));
        } else if (peer.iceGatheringState === "complete") {
          finish();
        }
      };
      peer.addEventListener("icegatheringstatechange", onStateChange);
      timeout = globalScope.setTimeout(
        () => finish(new Error("Preparing the direct connection timed out.")),
        15000,
      );
    });
  }

  async function startDirectSend() {
    cleanupDirect();
    const generation = directGeneration;
    directPhase = "creating-offer";
    showPanel("qr-transfer-direct-wait");
    setDirectStatus("Preparing a direct connection. No server is used.");
    try {
      await loadQrLibraries();
      if (generation !== directGeneration) return;
      const peer = createDirectPeer("sender", generation);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, generation);
      if (generation !== directGeneration) return;
      directPhase = "awaiting-answer";
      renderDirectSignal(peer.localDescription, "sender");
    } catch (error) {
      if (generation === directGeneration) {
        cleanupDirect();
        showPanel("qr-transfer-home");
        setStatus(error.message || "Unable to prepare a direct transfer.", true);
      }
    }
  }

  async function startDirectReceive() {
    cleanupDirect();
    if (!globalScope.isSecureContext) {
      setStatus("Direct transfer requires a secure HTTPS connection.", true);
      return;
    }
    directRole = "receiver";
    directPhase = "awaiting-offer";
    setDirectStatus("Scan the connection code shown on the sending device.");
    await startScan();
  }

  async function handleDirectSignal(signal, expectedType) {
    const description = parseDirectSignal(signal, expectedType);
    cleanupMedia();
    const generation = directGeneration;
    try {
      if (expectedType === "offer") {
        directPhase = "creating-answer";
        showPanel("qr-transfer-direct-wait");
        setDirectStatus("Preparing a secure direct connection…");
        await loadQrLibraries();
        if (generation !== directGeneration) return;
        const peer = createDirectPeer("receiver", generation);
        await peer.setRemoteDescription(description);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await waitForIceGathering(peer, generation);
        if (generation !== directGeneration) return;
        directPhase = "answer-shown";
        renderDirectSignal(peer.localDescription, "receiver");
      } else {
        directPhase = "connecting";
        showPanel("qr-transfer-direct-wait");
        setDirectStatus("Connecting directly to the other device…");
        await directPeer.setRemoteDescription(description);
        if (generation !== directGeneration) return;
        if (
          directChannel?.readyState !== "open" &&
          directPeer?.connectionState !== "connected"
        ) {
          armDirectConnectionTimeout(generation);
        }
      }
    } catch (error) {
      if (generation === directGeneration) {
        cleanupDirect();
        showPanel("qr-transfer-home");
        setStatus(error.message || "Unable to establish a direct transfer.", true);
      }
    }
  }

  function configureDirectChannel(channel, role, generation) {
    channel.onopen = () => {
      if (generation !== directGeneration) return;
      globalScope.clearTimeout(directConnectionTimer);
      directConnectionTimer = 0;
      if (role === "sender") {
        sendDirectTransfer(channel, generation).catch((error) => {
          if (generation === directGeneration) {
            setDirectStatus(error.message || "Unable to send progress directly.", true);
          }
        });
      } else {
        showPanel("qr-transfer-direct-wait");
        setDirectStatus("Connected securely. Receiving progress directly…");
      }
    };
    channel.onmessage = (event) => {
      if (generation !== directGeneration) return;
      if (role === "receiver") {
        receiveDirectMessage(event.data, channel);
        return;
      }
      try {
        const message = JSON.parse(event.data);
        if (
          message?.type === "mrh-transfer-verified" &&
          message.id === directTransferId
        ) {
          directPhase = "verified";
          setDirectStatus(
            "The receiving device verified the data. It still needs to confirm the import.",
          );
        }
      } catch (error) {
        setDirectStatus(
          error.message || "The direct connection sent an invalid response.",
          true,
        );
      }
    };
    channel.onerror = () => {
      if (generation === directGeneration) {
        setDirectStatus("The direct transfer connection encountered an error.", true);
      }
    };
    channel.onclose = () => {
      if (
        generation === directGeneration &&
        role === "receiver" &&
        !pendingImport
      ) {
        setDirectStatus(
          "The direct connection closed before transfer completed.",
          true,
        );
      }
    };
  }

  async function sendDirectTransfer(channel, generation) {
    const bytes = new TextEncoder().encode(createTransferData());
    if (bytes.byteLength > MAX_TRANSFER_FILE_BYTES) {
      throw new RangeError("Saved progress is larger than the 10 MB transfer limit.");
    }
    const encoded = bytesToBase64Url(bytes);
    const transferId =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    directTransferId = transferId;
    const total = Math.ceil(encoded.length / DIRECT_DATA_CHUNK_SIZE);
    channel.bufferedAmountLowThreshold = 128 * 1024;
    channel.send(
      JSON.stringify({
        type: "mrh-transfer-start",
        id: transferId,
        total,
        encodedLength: encoded.length,
        checksum: crc32(encoded),
      }),
    );
    for (let index = 0; index < total; index += 1) {
      if (generation !== directGeneration || channel.readyState !== "open") {
        throw new Error("The direct connection closed before transfer completed.");
      }
      while (channel.bufferedAmount > 256 * 1024) {
        await new Promise((resolve, reject) => {
          const onLow = () => {
            channel.removeEventListener("bufferedamountlow", onLow);
            channel.removeEventListener("close", onClose);
            resolve();
          };
          const onClose = () => {
            channel.removeEventListener("bufferedamountlow", onLow);
            channel.removeEventListener("close", onClose);
            reject(new Error("The direct connection closed during transfer."));
          };
          channel.addEventListener("bufferedamountlow", onLow, { once: true });
          channel.addEventListener("close", onClose, { once: true });
          if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) {
            onLow();
          }
        });
      }
      channel.send(
        JSON.stringify({
          type: "mrh-transfer-chunk",
          id: transferId,
          index,
          data: encoded.slice(
            index * DIRECT_DATA_CHUNK_SIZE,
            (index + 1) * DIRECT_DATA_CHUNK_SIZE,
          ),
        }),
      );
    }
    if (generation === directGeneration) {
      directPhase = "sent";
      showPanel("qr-transfer-direct-wait");
      setDirectStatus(
        "Progress sent directly. The receiving device must confirm the import.",
      );
    }
  }

  function receiveDirectMessage(data, channel) {
    try {
      if (typeof data !== "string" || data.length > DIRECT_DATA_CHUNK_SIZE + 500) {
        throw new TypeError("The direct transfer sent an invalid message.");
      }
      const message = JSON.parse(data);
      if (!isRecord(message)) {
        throw new TypeError("The direct transfer sent an invalid message.");
      }
      if (message.type === "mrh-transfer-start") {
        if (
          typeof message.id !== "string" ||
          !/^[A-Za-z0-9_-]{6,32}$/.test(message.id) ||
          !Number.isSafeInteger(message.total) ||
          message.total < 1 ||
          message.total > Math.ceil(
            ((MAX_TRANSFER_FILE_BYTES * 4) / 3) / DIRECT_DATA_CHUNK_SIZE,
          ) ||
          !Number.isSafeInteger(message.encodedLength) ||
          message.encodedLength < 1 ||
          message.encodedLength > Math.ceil((MAX_TRANSFER_FILE_BYTES * 4) / 3) ||
          message.total !==
            Math.ceil(message.encodedLength / DIRECT_DATA_CHUNK_SIZE) ||
          typeof message.checksum !== "string" ||
          !/^[a-f0-9]{8}$/.test(message.checksum)
        ) {
          throw new TypeError("The direct transfer header is invalid.");
        }
        directReceive = {
          id: message.id,
          total: message.total,
          encodedLength: message.encodedLength,
          checksum: message.checksum,
          chunks: new Map(),
        };
        setDirectStatus(`Receiving progress (0 of ${message.total} parts)…`);
        return;
      }
      if (message.type !== "mrh-transfer-chunk") return;
      const transfer = directReceive;
      if (
        !transfer ||
        message.id !== transfer.id ||
        !Number.isSafeInteger(message.index) ||
        message.index < 0 ||
        message.index >= transfer.total ||
        typeof message.data !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(message.data) ||
        message.data.length > DIRECT_DATA_CHUNK_SIZE
      ) {
        throw new TypeError("The direct transfer part is invalid.");
      }
      const expectedLength =
        message.index === transfer.total - 1
          ? transfer.encodedLength -
            message.index * DIRECT_DATA_CHUNK_SIZE
          : DIRECT_DATA_CHUNK_SIZE;
      if (message.data.length !== expectedLength) {
        throw new TypeError("The direct transfer part has an invalid size.");
      }
      const previous = transfer.chunks.get(message.index);
      if (previous !== undefined && previous !== message.data) {
        throw new TypeError("The direct transfer contains conflicting parts.");
      }
      if (previous === undefined) transfer.chunks.set(message.index, message.data);
      if (transfer.chunks.size !== transfer.total) {
        setDirectStatus(
          `Receiving progress (${transfer.chunks.size} of ${transfer.total} parts)…`,
        );
        return;
      }
      let encoded = "";
      for (let index = 0; index < transfer.total; index += 1) {
        const part = transfer.chunks.get(index);
        if (typeof part !== "string") return;
        encoded += part;
      }
      if (
        encoded.length !== transfer.encodedLength ||
        crc32(encoded) !== transfer.checksum
      ) {
        throw new TypeError("The direct transfer failed its integrity check.");
      }
      pendingImport = parseTransferFileText(base64UrlToText(encoded));
      directPhase = "received";
      channel.send(JSON.stringify({ type: "mrh-transfer-verified", id: transfer.id }));
      cleanupMedia();
      showPanel("qr-transfer-import");
      setStatus(
        "Transfer verified. Importing progress replaces this device’s saved progress; choose whether to replace its settings too.",
      );
    } catch (error) {
      directReceive = null;
      setDirectStatus(error.message || "The direct transfer could not be verified.", true);
    }
  }

  function open() {
    const modal = getElement("qr-transfer-modal");
    if (!modal) throw new Error("The progress-transfer dialog is unavailable.");
    modalGeneration += 1;
    cleanupMedia();
    cleanupDirect();
    clearInterval(frameTimer);
    frameTimer = 0;
    frameGeneration += 1;
    pendingImport = null;
    receivedFrames = null;
    showPanel("qr-transfer-home");
    setStatus("");
    modal.setAttribute("aria-hidden", "false");
    modal.classList.remove("opacity-0");
    modal.classList.add("opacity-100");
    modalKeydownHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modal.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!modal.contains(document.activeElement) && event.shiftKey) {
        event.preventDefault();
        last.focus();
      } else if (!modal.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", modalKeydownHandler);
    getElement("qr-transfer-export-button")?.focus();
  }

  function close() {
    const modal = getElement("qr-transfer-modal");
    modalGeneration += 1;
    if (modalKeydownHandler) {
      document.removeEventListener("keydown", modalKeydownHandler);
      modalKeydownHandler = null;
    }
    cleanupMedia();
    cleanupDirect();
    clearInterval(frameTimer);
    frameTimer = 0;
    frameGeneration += 1;
    pendingImport = null;
    receivedFrames = null;
    if (!modal) return;
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("opacity-100");
    modal.classList.add("opacity-0");
    getElement("btn-qr-transfer")?.focus();
  }

  function showHome() {
    cleanupMedia();
    cleanupDirect();
    clearInterval(frameTimer);
    frameTimer = 0;
    frameGeneration += 1;
    pendingImport = null;
    receivedFrames = null;
    showPanel("qr-transfer-home");
    setStatus("");
  }

  function cleanupMedia() {
    scannerGeneration += 1;
    if (scannerFrame && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(scannerFrame);
      scannerFrame = 0;
    }
    if (cameraStream) {
      for (const track of cameraStream.getTracks()) track.stop();
      cameraStream = null;
    }
    const video = getElement("qr-transfer-video");
    if (video) video.srcObject = null;
  }

  function cleanupDirect() {
    directGeneration += 1;
    directRole = null;
    directPhase = null;
    directReceive = null;
    directTransferId = null;
    globalScope.clearTimeout(directConnectionTimer);
    directConnectionTimer = 0;
    const channel = directChannel;
    const peer = directPeer;
    directChannel = null;
    directPeer = null;
    if (channel && channel.readyState !== "closed") channel.close();
    if (peer && peer.signalingState !== "closed") peer.close();
  }

  function crc32(value) {
    let crc = 0xffffffff;
    for (let index = 0; index < value.length; index += 1) {
      crc ^= value.charCodeAt(index);
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return globalScope
      .btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function base64UrlToText(encoded) {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = globalScope.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function createDirectSignal(description) {
    if (
      !isRecord(description) ||
      !["offer", "answer"].includes(description.type) ||
      typeof description.sdp !== "string" ||
      description.sdp.length === 0
    ) {
      throw new TypeError("The direct connection code is invalid.");
    }
    const signal = `MRH-DIRECT-1|${bytesToBase64Url(
      new TextEncoder().encode(
        JSON.stringify({ type: description.type, sdp: description.sdp }),
      ),
    )}`;
    if (signal.length > MAX_DIRECT_SIGNAL_CHARACTERS) {
      throw new RangeError(
        "The direct connection code is too large. Try the transfer file instead.",
      );
    }
    return signal;
  }

  function parseDirectSignal(signal, expectedType) {
    if (
      typeof signal !== "string" ||
      signal.length > MAX_DIRECT_SIGNAL_CHARACTERS
    ) {
      throw new TypeError("This is not a valid direct connection QR code.");
    }
    const match = signal.match(/^MRH-DIRECT-1\|([A-Za-z0-9_-]+)$/);
    if (!match) {
      throw new TypeError("This is not a valid direct connection QR code.");
    }
    let description;
    try {
      description = JSON.parse(base64UrlToText(match[1]));
    } catch {
      throw new TypeError("The direct connection code could not be read.");
    }
    if (
      !isRecord(description) ||
      description.type !== expectedType ||
      typeof description.sdp !== "string" ||
      !description.sdp ||
      description.sdp.length > 15000 ||
      !/^v=0\r?\n/.test(description.sdp)
    ) {
      throw new TypeError(
        `This code is not a valid direct connection ${expectedType}.`,
      );
    }
    return { type: description.type, sdp: description.sdp };
  }

  function createFrames(text, id) {
    if (typeof text !== "string" || !text) {
      throw new TypeError("There is no progress data to transfer.");
    }
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > MAX_TRANSFER_BYTES) {
      throw new RangeError("Saved progress is too large to transfer by QR code.");
    }
    const encoded = bytesToBase64Url(bytes);
    const transferId =
      id ||
      (globalScope.crypto?.getRandomValues
        ? Array.from(
            globalScope.crypto.getRandomValues(new Uint8Array(6)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
    const total = Math.max(1, Math.ceil(encoded.length / FRAME_CHUNK_SIZE));
    if (total > MAX_FRAME_COUNT) {
      throw new RangeError("Saved progress requires too many QR frames.");
    }
    const checksum = crc32(encoded);
    const frames = [];
    for (let index = 0; index < total; index += 1) {
      const part = encoded.slice(
        index * FRAME_CHUNK_SIZE,
        (index + 1) * FRAME_CHUNK_SIZE,
      );
      frames.push(`MRH1|${transferId}|${index + 1}|${total}|${checksum}|${part}`);
    }
    return frames;
  }

  function acceptFrame(frameSet, frameText) {
    const match =
      typeof frameText === "string" &&
      frameText.match(
        /^MRH1\|([A-Za-z0-9_-]{6,24})\|(\d{1,4})\|(\d{1,4})\|([a-fA-F0-9]{8})\|([A-Za-z0-9_-]+)$/,
      );
    if (!match) {
      throw new TypeError("This is not a Maritime Review Hub transfer QR.");
    }
    const [, id, indexText, totalText, checksum, chunk] = match;
    const index = Number(indexText);
    const total = Number(totalText);
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(total) ||
      index < 1 ||
      total < 1 ||
      index > total ||
      total > MAX_FRAME_COUNT
    ) {
      throw new TypeError("The transfer QR contains invalid frame numbers.");
    }
    if (chunk.length > FRAME_CHUNK_SIZE) {
      throw new RangeError("A transfer QR frame exceeds the maximum frame size.");
    }

    if (!frameSet || frameSet.id !== id) {
      frameSet = {
        id,
        total,
        checksum: checksum.toLowerCase(),
        chunks: new Map(),
      };
    } else if (
      frameSet.total !== total ||
      frameSet.checksum !== checksum.toLowerCase()
    ) {
      throw new TypeError("QR frames from different transfers were mixed.");
    }
    const isNewFrame = !frameSet.chunks.has(index);
    if (!isNewFrame && frameSet.complete) {
      return {
        frameSet,
        complete: true,
        text: frameSet.text,
        isNewFrame: false,
      };
    }
    frameSet.chunks.set(index, chunk);

    let receivedLength = 0;
    for (const part of frameSet.chunks.values()) receivedLength += part.length;
    if (receivedLength > Math.ceil((MAX_TRANSFER_BYTES * 4) / 3)) {
      throw new RangeError("The QR transfer exceeds the maximum size.");
    }

    if (frameSet.chunks.size !== total) {
      return { frameSet, complete: false, isNewFrame };
    }
    let encoded = "";
    for (let partIndex = 1; partIndex <= total; partIndex += 1) {
      const part = frameSet.chunks.get(partIndex);
      if (typeof part !== "string") {
        return { frameSet, complete: false };
      }
      if (
        (partIndex < total && part.length !== FRAME_CHUNK_SIZE) ||
        (partIndex === total &&
          (part.length === 0 || part.length > FRAME_CHUNK_SIZE))
      ) {
        throw new TypeError("The transfer QR contains an invalid frame size.");
      }
      encoded += part;
    }
    if (total !== Math.ceil(encoded.length / FRAME_CHUNK_SIZE)) {
      throw new TypeError("The transfer QR contains an invalid frame count.");
    }
    if (crc32(encoded) !== frameSet.checksum) {
      throw new TypeError("The transfer QR failed its integrity check.");
    }
    const text = base64UrlToText(encoded);
    frameSet.complete = true;
    frameSet.text = text;
    return { frameSet, complete: true, text, isNewFrame };
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isNonNegativeFinite(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  function isSafeIndexMap(value, validateValue) {
    return (
      isRecord(value) &&
      Object.entries(value).every(
        ([key, entry]) =>
          key !== "__proto__" && key.length <= 256 && validateValue(entry),
      )
    );
  }

  function validateSavedSession(session) {
    if (
      !isRecord(session) ||
      session.active !== true ||
      !Array.isArray(session.questions) ||
      session.questions.length === 0 ||
      session.questions.length > 10000 ||
      !Number.isInteger(session.currentIndex) ||
      session.currentIndex < 0 ||
      session.currentIndex >= session.questions.length ||
      !isIndexValueMap(session.userAnswers, session.questions.length, (value) =>
        ["A", "B", "C", "D", "E", "REVEALED"].includes(value),
      )
    ) {
      return false;
    }

    const questionsAreValid = session.questions.every(
      (question) =>
        isRecord(question) &&
        typeof question.Subject === "string" &&
        question.Subject.length <= 500 &&
        (typeof question.ID === "string" ||
          typeof question.ID === "number" ||
          typeof question.Question === "string") &&
        [
          "ID",
          "Question",
          "Explanation",
          "Answer",
          "ChoiceA",
          "ChoiceB",
          "ChoiceC",
          "ChoiceD",
          "ChoiceE",
          "ImageURL",
        ].every(
          (key) =>
            question[key] == null ||
            ["string", "number"].includes(typeof question[key]),
        ),
    );
    if (!questionsAreValid) return false;

    for (const key of [
      "answerResults",
      "identificationRatings",
      "identificationRatingPending",
    ]) {
      if (
        session[key] !== undefined &&
        !isIndexValueMap(
          session[key],
          session.questions.length,
          (value) => typeof value === "boolean",
        )
      ) {
        return false;
      }
    }
    return true;
  }

  function isIndexValueMap(value, questionCount, validateValue) {
    return (
      isRecord(value) &&
      Object.entries(value).every(
        ([key, entry]) =>
          /^(0|[1-9]\d*)$/.test(key) &&
          Number(key) < questionCount &&
          validateValue(entry),
      )
    );
  }

  function validateProgress(progress) {
    if (!isRecord(progress)) return false;
    if (
      progress.studyProgress !== undefined &&
      !isSafeIndexMap(progress.studyProgress, (entry) =>
        isRecord(entry) &&
        ["page", "index", "scrollY"].every(
          (key) =>
            entry[key] === undefined ||
            (typeof entry[key] === "number" && Number.isFinite(entry[key])),
        ),
      )
    ) {
      return false;
    }
    if (
      progress.qToggles !== undefined &&
      !isSafeIndexMap(
        progress.qToggles,
        (entry) => typeof entry === "boolean",
      )
    ) {
      return false;
    }
    if (
      progress.lastActivity !== null &&
      progress.lastActivity !== undefined &&
      (!isRecord(progress.lastActivity) ||
        !["quiz", "review"].includes(progress.lastActivity.mode) ||
        (progress.lastActivity.subject !== undefined &&
          progress.lastActivity.subject !== null &&
          (typeof progress.lastActivity.subject !== "string" ||
            progress.lastActivity.subject.length > 500)))
    ) {
      return false;
    }
    return true;
  }

  function validateTransfer(transfer) {
    if (
      !isRecord(transfer) ||
      transfer.format !== "mrh-progress-transfer" ||
      transfer.version !== 1 ||
      !isRecord(transfer.stats) ||
      !isNonNegativeFinite(transfer.stats.totalAnswered) ||
      !isNonNegativeFinite(transfer.stats.correct) ||
      transfer.stats.correct > transfer.stats.totalAnswered ||
      !Array.isArray(transfer.stats.mistakes) ||
      !transfer.stats.mistakes.every(
        (value) =>
          (typeof value === "string" && value.length <= 500) ||
          (typeof value === "number" && Number.isFinite(value)),
      ) ||
      !Array.isArray(transfer.stats.completedQs) ||
      !transfer.stats.completedQs.every(
        (value) =>
          (typeof value === "string" && value.length <= 500) ||
          (typeof value === "number" && Number.isFinite(value)),
      ) ||
      !isSafeIndexMap(transfer.stats.subjectAccuracy, (entry) =>
        (typeof entry === "number" && Number.isFinite(entry)) ||
        (isRecord(entry) &&
          isNonNegativeFinite(entry.total) &&
          isNonNegativeFinite(entry.correct) &&
          (entry.total === 0 || entry.correct <= entry.total)),
      ) ||
      !isSafeIndexMap(transfer.stats.srsMap, (entry) =>
        isRecord(entry) &&
        ["reps", "step", "interval", "ease", "due", "lastAnsweredAt", "lapses"]
          .every(
            (key) =>
              entry[key] === undefined ||
              (typeof entry[key] === "number" && Number.isFinite(entry[key])),
          ) &&
        (entry.lastScore === undefined ||
          ["correct", "wrong"].includes(entry.lastScore)),
      ) ||
      !isRecord(transfer.settings) ||
      !validateProgress(transfer.progress) ||
      !(
        transfer.savedSession === null ||
        validateSavedSession(transfer.savedSession)
      )
    ) {
      throw new TypeError("The QR code does not contain valid progress data.");
    }
    return transfer;
  }

  function createTransferData() {
    const state = globalScope.state;
    if (!state?.stats || !state?.prefs) {
      throw new Error("Your saved progress is not ready to export.");
    }
    if (state.session?.active) {
      if (typeof globalScope.saveSessionProgress !== "function") {
        throw new Error("The active session cannot be saved for transfer.");
      }
      if (globalScope.saveSessionProgress(true) === false) {
        throw new Error("Unable to save the active quiz before export.");
      }
    }
    const savedSession =
      globalScope.AppState?.getStoredJSON?.("saved_session", null) ?? null;
    const settings = { ...state.prefs };
    delete settings.lastActivity;
    delete settings.studyProgress;
    delete settings.qToggles;
    delete settings.localDownloadDeletedDecks;
    const progress = {
      studyProgress: state.prefs.studyProgress || {},
      qToggles: state.prefs.qToggles || {},
      lastActivity: state.prefs.lastActivity || null,
    };
    if (state.session?.active && !savedSession?.active) {
      throw new Error("The active quiz could not be included in the transfer.");
    }
    const transfer = {
      format: "mrh-progress-transfer",
      version: 1,
      createdAt: new Date().toISOString(),
      stats: state.stats,
      progress,
      settings,
      savedSession:
        savedSession && typeof savedSession === "object"
          ? { ...savedSession, autoNextTimeout: null }
          : null,
    };
    validateTransfer(transfer);
    return JSON.stringify(transfer);
  }

  function parseTransferFileText(text) {
    if (typeof text !== "string") {
      throw new TypeError("The selected file could not be read.");
    }
    if (new TextEncoder().encode(text).byteLength > MAX_TRANSFER_FILE_BYTES) {
      throw new RangeError("The transfer file is larger than the 10 MB limit.");
    }
    let transfer;
    try {
      transfer = JSON.parse(text);
    } catch {
      throw new TypeError("The selected file is not valid transfer JSON.");
    }
    return validateTransfer(transfer);
  }

  function exportFile() {
    let downloadUrl = null;
    try {
      const text = createTransferData();
      const bytes = new TextEncoder().encode(text);
      if (bytes.byteLength > MAX_TRANSFER_FILE_BYTES) {
        throw new RangeError("Saved progress is larger than the 10 MB file limit.");
      }
      if (
        !globalScope.URL?.createObjectURL ||
        typeof globalScope.Blob !== "function"
      ) {
        throw new Error("File downloads are not supported in this browser.");
      }
      downloadUrl = globalScope.URL.createObjectURL(
        new globalScope.Blob([bytes], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `maritime-review-hub-progress-${new Date()
        .toISOString()
        .slice(0, 10)}.mrh-transfer.json`;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      const urlToRevoke = downloadUrl;
      globalScope.setTimeout(
        () => globalScope.URL.revokeObjectURL(urlToRevoke),
        60000,
      );
      downloadUrl = null;
      setStatus(
        "Transfer file downloaded. Send it directly to your other device; it contains private progress data, so only share it with a device you trust.",
      );
    } catch (error) {
      if (downloadUrl) globalScope.URL.revokeObjectURL(downloadUrl);
      setStatus(error.message || "Unable to create the transfer file.", true);
    }
  }

  async function importFile(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const fileGeneration = ++fileImportGeneration;
    const generation = modalGeneration;
    try {
      if (file.size > MAX_TRANSFER_FILE_BYTES) {
        throw new RangeError("The transfer file is larger than the 10 MB limit.");
      }
      if (typeof file.text !== "function") {
        throw new Error("Reading files is not supported in this browser.");
      }
      setStatus("Reading and validating the transfer file…");
      const transfer = parseTransferFileText(await file.text());
      if (
        generation !== modalGeneration ||
        fileGeneration !== fileImportGeneration
      ) {
        return;
      }
      pendingImport = transfer;
      showPanel("qr-transfer-import");
      setStatus(
        "Transfer verified. Importing progress replaces this device’s saved progress; choose whether to replace its settings too.",
      );
    } catch (error) {
      if (
        generation === modalGeneration &&
        fileGeneration === fileImportGeneration
      ) {
        setStatus(error.message || "Unable to read the transfer file.", true);
      }
    } finally {
      if (fileGeneration === fileImportGeneration) input.value = "";
    }
  }

  function loadQrLibraries() {
    if (libraryPromise) return libraryPromise;
    libraryPromise = Promise.all(
      QR_LIBRARIES.map(
        ({ name, src }) =>
          new Promise((resolve, reject) => {
            if (globalScope[name]) {
              resolve();
              return;
            }
            const script = document.createElement("script");
            const baseHref =
              globalScope.location?.protocol === "file:"
                ? globalScope.location.href
                : new URL(
                    globalScope.__MRH_APP_BASE_PATH || "/",
                    globalScope.location.origin,
                  ).href;
            const libraryUrl = new URL(src, baseHref);
            const appVersion = globalScope.__MRH_APP__?.version;
            if (typeof appVersion === "string") {
              libraryUrl.searchParams.set("v", appVersion);
            }
            script.src = libraryUrl.href;
            const timeout = setTimeout(() => {
              script.remove();
              reject(
                new Error(
                  "Loading the QR transfer tools timed out. Check your connection and try again.",
                ),
              );
            }, 15000);
            script.onload = () => {
              clearTimeout(timeout);
              if (globalScope[name]) resolve();
              else {
                reject(new Error(`The QR library ${name} did not initialize.`));
              }
            };
            script.onerror = () => {
              clearTimeout(timeout);
              script.remove();
              reject(
                new Error(
                  "Could not load the QR transfer tools. Reload the page and try again.",
                ),
              );
            };
            document.head.appendChild(script);
          }),
      ),
    ).catch((error) => {
      libraryPromise = null;
      throw error;
    });
    return libraryPromise;
  }

  function renderFrame(frames) {
    const image = getElement("qr-transfer-image");
    if (!image || !globalScope.qrcode) {
      throw new Error("The QR code display is not available.");
    }
    const qr = globalScope.qrcode(0, "M");
    qr.addData(frames[frameIndex]);
    qr.make();
    image.src = qr.createDataURL(4, 4);
    image.alt = `Transfer QR frame ${frameIndex + 1} of ${frames.length}`;
    const counter = getElement("qr-transfer-frame-count");
    if (counter) {
      counter.textContent = `Frame ${frameIndex + 1} of ${frames.length}`;
    }
  }

  async function startExport() {
    clearInterval(frameTimer);
    frameTimer = 0;
    const generation = ++frameGeneration;
    showPanel("qr-transfer-export");
    setStatus("Preparing your saved progress…");
    try {
      await loadQrLibraries();
      if (generation !== frameGeneration) return;
      const frames = createFrames(createTransferData());
      frameIndex = 0;
      renderFrame(frames);
      setStatus(
        "On the other device, choose Scan QR code and keep its camera pointed here.",
      );
      if (frames.length > 1) {
        frameTimer = setInterval(() => {
          if (generation !== frameGeneration) return;
          frameIndex = (frameIndex + 1) % frames.length;
          try {
            renderFrame(frames);
          } catch (error) {
            clearInterval(frameTimer);
            frameTimer = 0;
            setStatus(error.message, true);
          }
        }, FRAME_INTERVAL_MS);
      }
    } catch (error) {
      if (generation !== frameGeneration) return;
      setStatus(error.message || "Unable to prepare the progress transfer.", true);
    }
  }

  async function startScan() {
    cleanupMedia();
    showPanel("qr-transfer-scan");
    setStatus("Requesting camera access…");
    const generation = ++scannerGeneration;
    const isDirectScan =
      directPhase === "awaiting-offer" || directPhase === "awaiting-answer";
    getElement("qr-transfer-signal-input")?.classList.toggle(
      "hidden",
      !isDirectScan,
    );
    getElement("qr-transfer-use-signal-button")?.classList.toggle(
      "hidden",
      !isDirectScan,
    );
    const video = getElement("qr-transfer-video");
    const canvas = getElement("qr-transfer-canvas");
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(
        "Camera scanning is not supported in this browser. Open the site over HTTPS in a supported browser.",
        true,
      );
      return;
    }
    if (!globalScope.isSecureContext) {
      setStatus("Camera access requires a secure HTTPS connection.", true);
      return;
    }
    try {
      await loadQrLibraries();
      if (generation !== scannerGeneration) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (generation !== scannerGeneration) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      cameraStream = stream;
      if (!video || !canvas) throw new Error("The camera preview is unavailable.");
      video.srcObject = cameraStream;
      await video.play();
      if (generation !== scannerGeneration) return;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("The camera scanner could not start.");

      const scan = () => {
        if (generation !== scannerGeneration) return;
        if (Date.now() - lastScanAt < SCAN_INTERVAL_MS) {
          scannerFrame = requestAnimationFrame(scan);
          return;
        }
        lastScanAt = Date.now();
        if (!cameraStream || !video.videoWidth) {
          scannerFrame = requestAnimationFrame(scan);
          return;
        }
        const width = Math.min(video.videoWidth, MAX_SCAN_WIDTH);
        const height = Math.round((video.videoHeight / video.videoWidth) * width);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        let result;
        try {
          context.drawImage(video, 0, 0, width, height);
          const imageData = context.getImageData(0, 0, width, height);
          result = globalScope.jsQR(imageData.data, width, height, {
            inversionAttempts: "attemptBoth",
          });
        } catch (error) {
          cleanupMedia();
          setStatus(
            error.message || "The camera scanner encountered an error.",
            true,
          );
          return;
        }
        if (result?.data) {
          if (
            directPhase === "awaiting-offer" ||
            directPhase === "awaiting-answer"
          ) {
            const expectedType =
              directPhase === "awaiting-offer" ? "offer" : "answer";
            if (result.data.startsWith("MRH-DIRECT-1|")) {
              directPhase = `processing-${expectedType}`;
              handleDirectSignal(result.data, expectedType).catch((error) => {
                if (generation === scannerGeneration) {
                  directPhase =
                    expectedType === "offer"
                      ? "awaiting-offer"
                      : "awaiting-answer";
                  setStatus(error.message, true);
                }
              });
            }
          } else {
            try {
              const accepted = acceptFrame(receivedFrames, result.data);
              receivedFrames = accepted.frameSet;
              if (accepted.isNewFrame) {
                const progress = getElement("qr-transfer-scan-progress");
                if (progress) {
                  progress.textContent = `Scanned ${receivedFrames.chunks.size} of ${receivedFrames.total} frames`;
                }
              }
              if (accepted.complete && accepted.isNewFrame) {
                pendingImport = validateTransfer(JSON.parse(accepted.text));
                cleanupMedia();
                showPanel("qr-transfer-import");
                setStatus(
                  "Transfer verified. Importing progress replaces this device’s saved progress; choose whether to replace its settings too.",
                );
                return;
              }
            } catch (error) {
              if (
                /not a Maritime Review Hub transfer QR/.test(error.message)
              ) {
                // Ignore unrelated QR codes while continuing the current transfer.
              } else if (/different transfers/.test(error.message)) {
                receivedFrames = null;
              } else {
                receivedFrames = null;
                setStatus(error.message, true);
              }
            }
          }
        }
        if (generation === scannerGeneration) {
          scannerFrame = requestAnimationFrame(scan);
        }
      };
      setStatus("Point the camera at the other device’s QR code.");
      scannerFrame = requestAnimationFrame(scan);
    } catch (error) {
      const cancelled = generation !== scannerGeneration;
      cleanupMedia();
      if (cancelled) return;
      const message =
        error.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera access in your browser and try again."
          : error.name === "NotFoundError"
            ? "No camera was found on this device."
            : error.message || "Unable to start the QR scanner.";
      setStatus(message, true);
    }
  }

  async function importProgress(replaceSettings) {
    if (importInFlight) return;
    if (!pendingImport) {
      setStatus("Scan and verify a transfer before importing.", true);
      return;
    }
    if (globalScope.state?.session?.active) {
      setStatus("End the active quiz before importing progress.", true);
      return;
    }
    const transfer = pendingImport;
    const generation = modalGeneration;
    importInFlight = true;
    try {
      const succeeded =
        await globalScope.AppState.importTransferredState(
          transfer,
          replaceSettings,
        );
      if (!succeeded) throw new Error("The progress transfer could not be saved.");
      if (generation !== modalGeneration) return;
      showPanel("qr-transfer-done");
      setStatus(
        replaceSettings
          ? "Progress and settings were imported successfully."
          : "Progress was imported. This device’s settings were kept.",
      );
    } catch (error) {
      if (generation === modalGeneration) {
        setStatus(error.message || "The progress transfer could not be saved.", true);
      }
    } finally {
      importInFlight = false;
    }
  }

  function scanDirectAnswer() {
    if (directRole !== "sender" || directPhase !== "awaiting-answer") {
      setStatus("Start a direct send before scanning its response.", true);
      return;
    }
    startScan();
  }

  async function submitDirectSignal() {
    const input = getElement("qr-transfer-signal-input");
    if (
      !input?.value ||
      !["awaiting-offer", "awaiting-answer"].includes(directPhase)
    ) {
      setStatus("Paste a connection code while a direct transfer is waiting.", true);
      return;
    }
    const expectedType = directPhase === "awaiting-offer" ? "offer" : "answer";
    const signal = input.value.trim();
    try {
      parseDirectSignal(signal, expectedType);
      directPhase = `processing-${expectedType}`;
      await handleDirectSignal(signal, expectedType);
      input.value = "";
    } catch (error) {
      directPhase =
        expectedType === "offer" ? "awaiting-offer" : "awaiting-answer";
      setStatus(error.message || "The connection code could not be read.", true);
    }
  }

  const QRTransfer = {
    open,
    close,
    showHome,
    startExport,
    startScan,
    startDirectSend,
    startDirectReceive,
    scanDirectAnswer,
    submitDirectSignal,
    copyDirectSignal,
    exportFile,
    importFile,
    importProgress,
    internals: {
      acceptFrame,
      createFrames,
      crc32,
      validateTransfer,
      createTransferData,
      parseTransferFileText,
      createDirectSignal,
      parseDirectSignal,
      receiveDirectMessage,
      base64UrlToText,
      MAX_TRANSFER_BYTES,
      MAX_TRANSFER_FILE_BYTES,
      MAX_DIRECT_SIGNAL_CHARACTERS,
    },
  };
  globalScope.QRTransfer = QRTransfer;
  if (typeof module !== "undefined" && module.exports) module.exports = QRTransfer;
})(typeof window !== "undefined" ? window : globalThis);
