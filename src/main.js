import qrcode from "qrcode-generator";
import { getCSL } from "./csl.js";

/* ── Cardano mainnet constants (no external API needed) ── */
const SHELLEY_START_UNIX = 1596491091;
const SHELLEY_START_SLOT = 4924800;

function getCurrentSlot() {
  return SHELLEY_START_SLOT + (Math.floor(Date.now() / 1000) - SHELLEY_START_UNIX);
}

const PROTOCOL_PARAMS = {
  minFeeA: "44",
  minFeeB: "155381",
  keyDeposit: "2000000",
  poolDeposit: "500000000",
  coinsPerUtxoByte: "4310",
  maxValSize: 5000,
  maxTxSize: 16384
};

/* ── Minimal bech32 encoder for Cardano addresses ── */
      const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

      function bech32Polymod(values) {
        const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        let chk = 1;
        for (const v of values) {
          const b = chk >>> 25;
          chk = ((chk & 0x1ffffff) << 5) ^ v;
          for (let i = 0; i < 5; i++) {
            if ((b >>> i) & 1) chk ^= GEN[i];
          }
        }
        return chk;
      }

      function bech32HrpExpand(hrp) {
        const ret = [];
        for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >>> 5);
        ret.push(0);
        for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
        return ret;
      }

      function bech32CreateChecksum(hrp, data) {
        const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
        const polymod = bech32Polymod(values) ^ 1;
        const ret = [];
        for (let i = 0; i < 6; i++) ret.push((polymod >>> (5 * (5 - i))) & 31);
        return ret;
      }

      function bech32Encode(hrp, data) {
        const combined = data.concat(bech32CreateChecksum(hrp, data));
        return hrp + "1" + combined.map((d) => BECH32_CHARSET[d]).join("");
      }

      function convertBits(data, fromBits, toBits, pad) {
        let acc = 0;
        let bits = 0;
        const ret = [];
        const maxv = (1 << toBits) - 1;
        for (const value of data) {
          acc = (acc << fromBits) | value;
          bits += fromBits;
          while (bits >= toBits) {
            bits -= toBits;
            ret.push((acc >>> bits) & maxv);
          }
        }
        if (pad) {
          if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
        }
        return ret;
      }

      function hexToBytes(hex) {
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
          bytes.push(parseInt(hex.substring(i, i + 2), 16));
        }
        return bytes;
      }

      function bech32Decode(str) {
        const pos = str.lastIndexOf("1");
        if (pos < 1 || pos + 7 > str.length) throw new Error("Invalid bech32");
        const hrp = str.slice(0, pos);
        const dataChars = str.slice(pos + 1);
        const values = [];
        for (const c of dataChars) {
          const idx = BECH32_CHARSET.indexOf(c);
          if (idx === -1) throw new Error("Invalid bech32 character");
          values.push(idx);
        }
        const payload = values.slice(0, -6);
        const bytes = convertBits(payload, 5, 8, false);
        return { hrp, bytes: new Uint8Array(bytes) };
      }

      function hexToUint8Array(hex) {
        const arr = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return arr;
      }

      function uint8ArrayToHex(arr) {
        return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
      }

      function splitCip20Message(message, maxBytes = 64) {
        const text = String(message || "");
        const encoder = new TextEncoder();
        const chunks = [];
        let current = "";
        let currentBytes = 0;

        for (const char of text) {
          const charBytes = encoder.encode(char).length;
          if (currentBytes + charBytes > maxBytes) {
            chunks.push(current);
            current = char;
            currentBytes = charBytes;
          } else {
            current += char;
            currentBytes += charBytes;
          }
        }
        if (current) chunks.push(current);
        return chunks.length ? chunks : [""];
      }

      function hexToBech32Address(hex) {
        if (!hex || hex.length < 2) return hex || "";
        const bytes = hexToBytes(hex);
        const header = bytes[0];
        const addrType = (header & 0xf0) >>> 4;
        const network = header & 0x0f;

        let hrp;
        if (addrType === 14 || addrType === 15) {
          hrp = network === 0 ? "stake_test" : "stake";
        } else {
          hrp = network === 0 ? "addr_test" : "addr";
        }

        const fiveBit = convertBits(bytes, 8, 5, true);
        return bech32Encode(hrp, fiveBit);
      }

      class DotmQr extends HTMLElement {
        static get observedAttributes() {
          return ["value"];
        }

        constructor() {
          super();
          this.attachShadow({ mode: "open" });
        }

        connectedCallback() {
          this.render();
        }

        attributeChangedCallback() {
          this.render();
        }

        render() {
          const value = this.getAttribute("value") || "";
          const root = this.shadowRoot;
          if (!root) return;

          const styles = `
            <style>
              .qr-wrap {
                width: 180px;
                min-height: 180px;
                margin: 0 auto;
                border: 1px solid var(--line);
                border-radius: 12px;
                background: #fff;
                display: grid;
                place-items: center;
                overflow: hidden;
              }
              .empty {
                font-size: 0.875rem;
                color: #64748b;
                text-align: center;
                padding: 12px;
              }
            </style>
          `;

          if (!value || typeof qrcode !== "function") {
            root.innerHTML = `${styles}<div class="qr-wrap"><div class="empty">QR unavailable</div></div>`;
            return;
          }

          const qr = qrcode(0, "M");
          qr.addData(value);
          qr.make();
          root.innerHTML = `${styles}<div class="qr-wrap">${qr.createSvgTag({ scalable: true })}</div>`;
        }
      }
      customElements.define("dotm-qr", DotmQr);

      class DotmCard extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: "open" });
        }

        set data(value) {
          this._data = value;
          this.render();
        }

        getCardanoScanUrl(entry) {
          if (!entry) return "#";
          const id = entry.id || "";
          if (id.startsWith("drep")) {
            return `https://cardanoscan.io/dRep/${encodeURIComponent(entry.id)}`;
          }
          return `https://cardanoscan.io/pool/${encodeURIComponent(entry.id)}`;
        }

        formatDate(value) {
          if (!value) return "Unknown date";
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return "Unknown date";
          return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC"
          }).format(date);
        }

        platformLabel(platform) {
          const raw = (platform || "").toLowerCase();
          const map = {
            twitter: "X",
            x: "X",
            github: "GitHub",
            discord: "Discord",
            telegram: "Telegram",
            youtube: "YouTube",
            website: "Website"
          };
          return map[raw] || (platform || "Social");
        }

        render() {
          const root = this.shadowRoot;
          if (!root) return;

          const payload = this._data || {};
          const title = payload.sectionTitle || "Featured";
          const entry = payload.entry || null;
          const walletConnected = Boolean(payload.walletConnected);

          const style = `
            <style>
              :host {
                display: block;
              }
              .card {
                background: var(--card);
                border: 1px solid var(--line);
                border-radius: var(--radius);
                padding: 18px;
                height: 100%;
              }
              h2 {
                margin: 0 0 10px;
                font-size: 1.1rem;
              }
              h3 {
                margin: 0 0 6px;
                font-size: 1.35rem;
                line-height: 1.3;
              }
              .meta {
                color: var(--muted);
                font-size: 0.92rem;
                margin-bottom: 12px;
              }
              .id {
                display: block;
                margin: 10px 0 14px;
                font-size: 0.83rem;
                color: var(--muted);
                word-break: break-all;
              }
              .actions {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
                margin: 14px 0;
              }
              button,
              a.action {
                border-radius: 10px;
                padding: 10px 14px;
                border: 1px solid var(--line);
                background: transparent;
                color: var(--text);
                text-decoration: none;
                font-size: 0.9rem;
                cursor: pointer;
              }
              button {
                background: color-mix(in srgb, var(--accent) 22%, transparent);
                border-color: color-mix(in srgb, var(--accent) 44%, var(--line));
              }
              button:disabled {
                opacity: 0.45;
                cursor: not-allowed;
                background: transparent;
                border-color: var(--line);
              }
              ul {
                margin: 10px 0 0;
                padding-left: 18px;
              }
              li {
                margin: 5px 0;
              }
              .socials {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 12px;
              }
              .social {
                font-size: 0.86rem;
                padding: 6px 10px;
                border-radius: 999px;
                border: 1px solid var(--line);
                color: var(--text);
                text-decoration: none;
              }
              .empty {
                color: var(--muted);
                margin: 8px 0 0;
              }
            </style>
          `;

          if (!entry) {
            root.innerHTML = `
              ${style}
              <article class="card">
                <h2>${title}</h2>
                <p class="empty">No entry available for this date range.</p>
              </article>
            `;
            return;
          }

          const bulletPoints = Array.isArray(entry.bulletPoints) ? entry.bulletPoints : [];
          const socials = Array.isArray(entry.socials) ? entry.socials : [];
          const cardanoScanUrl = this.getCardanoScanUrl(entry);

          root.innerHTML = `
            ${style}
            <article class="card">
              <h2>${title}</h2>
              <h3>${entry.name || "Unnamed"}</h3>
              <div class="meta">Starts ${this.formatDate(entry.timestamp)}</div>
              <dotm-qr value="${entry.id || ""}"></dotm-qr>
              <small class="id">${entry.id || ""}</small>
              <div class="actions">
                <button
                  type="button"
                  aria-label="Delegate to ${entry.name || "featured"}"
                  ${walletConnected ? "" : "disabled"}
                  title="${walletConnected ? "Wallet connected" : "Connect wallet to delegate"}"
                >
                  Delegate
                </button>
                <a class="action" href="${cardanoScanUrl}" target="_blank" rel="noreferrer noopener">View on Cardano Scan</a>
              </div>
              ${
                bulletPoints.length
                  ? `<ul>${bulletPoints.map((item) => `<li>${item}</li>`).join("")}</ul>`
                  : `<p class="empty">No notes yet.</p>`
              }
              ${
                socials.length
                  ? `<div class="socials">${socials
                      .map(
                        (s) =>
                          `<a class="social" href="${s.url}" target="_blank" rel="noreferrer noopener">${this.platformLabel(
                            s.platform
                          )}</a>`
                      )
                      .join("")}</div>`
                  : ""
              }
            </article>
          `;

          const delegateBtn = root.querySelector("button[aria-label^='Delegate']");
          if (delegateBtn && !delegateBtn.disabled && typeof payload.onDelegate === "function") {
            delegateBtn.addEventListener("click", () => payload.onDelegate(entry));
          }
        }
      }
      customElements.define("dotm-card", DotmCard);

      class DotmApp extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: "open" });
          this.state = {
            loading: true,
            error: "",
            entities: [],
            snapshots: [],
            index: 0,
            walletsAvailable: [],
            walletConnected: false,
            connectedWalletName: "",
            connectedAddress: "",
            walletError: "",
            showingWalletPicker: false,
            walletApi: null,
            delegationStatus: "",
            delegationIsError: false,
            showRandomPopup: false,
            randomDrep: null,
            randomSpo: null,
            showEntriesPopup: false,
            showEntityDetailPopup: false,
            detailEntity: null,
            showAboutPopup: false
          };
        }

        connectedCallback() {
          this.discoverWallets();
          this.load();
        }

        discoverWallets() {
          const cardano = window.cardano && typeof window.cardano === "object" ? window.cardano : null;
          if (!cardano) {
            this.state.walletsAvailable = [];
            return;
          }

          const wallets = Object.entries(cardano)
            .filter(([, value]) => value && typeof value.enable === "function")
            .map(([key, value]) => ({
              key,
              name: value.name || key,
              api: value
            }));

          this.state.walletsAvailable = wallets;
        }

        showWalletPicker() {
          this.discoverWallets();
          const wallets = this.state.walletsAvailable || [];
          if (!wallets.length) {
            this.state.walletError = "No Cardano wallet found. Install a CIP-30 wallet extension.";
            this.state.showingWalletPicker = false;
            this.render();
            return;
          }
          this.state.showingWalletPicker = true;
          this.state.walletError = "";
          this.render();
        }

        async connectWallet(walletKey) {
          const wallets = this.state.walletsAvailable || [];
          const wallet = wallets.find((w) => w.key === walletKey);
          if (!wallet) return;

          this.state.showingWalletPicker = false;

          try {
            const api = await wallet.api.enable();
            const usedAddresses = (await api.getUsedAddresses()) || [];
            const rewardAddresses = usedAddresses.length ? [] : (await api.getRewardAddresses()) || [];
            const fallbackChange = !usedAddresses.length && !rewardAddresses.length ? await api.getChangeAddress() : "";
            const rawHex = usedAddresses[0] || rewardAddresses[0] || fallbackChange || "";
            const connectedAddress = rawHex ? hexToBech32Address(rawHex) : "Address unavailable";

            this.state.walletApi = api;
            this.state.walletConnected = true;
            this.state.connectedWalletName = wallet.name;
            this.state.connectedAddress = connectedAddress;
            this.state.walletError = "";
          } catch (_error) {
            this.state.walletConnected = false;
            this.state.connectedWalletName = "";
            this.state.connectedAddress = "";
            this.state.walletError = "Wallet connection was cancelled or failed.";
          }

          this.render();
        }

        async load() {
          try {
            const [entitiesResponse, scheduleResponse] = await Promise.all([
              fetch("./data.json", { cache: "no-store" }),
              fetch("./schedule.json", { cache: "no-store" })
            ]);
            if (!entitiesResponse.ok) {
              throw new Error(`Failed to load data.json (${entitiesResponse.status})`);
            }
            if (!scheduleResponse.ok) {
              throw new Error(`Failed to load schedule.json (${scheduleResponse.status})`);
            }
            const rawEntities = await entitiesResponse.json();
            const rawSchedule = await scheduleResponse.json();
            const now = new Date();

            const entities = (Array.isArray(rawEntities?.entities) ? rawEntities.entities : [])
              .filter((entity) => entity && typeof entity === "object")
              .filter((entity) => {
                const hasDrep = typeof entity.drepId === "string";
                const hasSpo = typeof entity.spoId === "string";
                return hasDrep || hasSpo;
              });

            const drepMap = new Map(
              entities
                .filter((entity) => typeof entity.drepId === "string")
                .map((entity) => [entity.drepId, entity])
            );
            const spoMap = new Map(
              entities
                .filter((entity) => typeof entity.spoId === "string")
                .map((entity) => [entity.spoId, entity])
            );

            const snapshots = (Array.isArray(rawSchedule?.schedule) ? rawSchedule.schedule : [])
              .filter((row) => row && typeof row === "object")
              .filter(
                (row) => typeof row.drepId === "string" && typeof row.spoId === "string"
              )
              .filter((row) => {
                const date = new Date(row.timestamp);
                return !Number.isNaN(date.getTime()) && date.getTime() <= now.getTime();
              })
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((row) => {
                const drepEntity = drepMap.get(row.drepId) || null;
                const spoEntity = spoMap.get(row.spoId) || null;
                return {
                  drep: drepEntity ? { ...drepEntity, id: row.drepId, timestamp: row.timestamp } : null,
                  spo: spoEntity ? { ...spoEntity, id: row.spoId, timestamp: row.timestamp } : null
                };
              });

            this.state = {
              ...this.state,
              loading: false,
              error: "",
              entities,
              snapshots,
              index: 0
            };
          } catch (error) {
            this.state = {
              ...this.state,
              loading: false,
              error: error instanceof Error ? error.message : "Unable to load data",
              snapshots: [],
              index: 0
            };
          }
          this.render();
        }

        setDelegationStatus(msg, isError = false) {
          this.state.delegationStatus = msg;
          this.state.delegationIsError = isError;
          this.render();
        }

        formatMonthYear(timestamp) {
          const date = new Date(timestamp);
          if (Number.isNaN(date.getTime())) return "Unknown period";
          const monthName = date.toLocaleString(undefined, { month: "long", timeZone: "UTC" });
          const year = date.getUTCFullYear();
          return `${monthName} ${year}`;
        }

        getSingleDelegationMessage(entry) {
          const idPrefix = (entry?.id || "").split("1")[0];
          const delegType = idPrefix === "drep" ? "DRep" : "SPO";
          return `Delegate to ${delegType} of the month for ${this.formatMonthYear(entry?.timestamp)}`;
        }

        createDelegationCertificate(CSL, stakeCred, delegationId) {
          const idPrefix = (delegationId || "").split("1")[0];

          if (idPrefix === "drep") {
            const decoded = bech32Decode(delegationId);
            const credTypeByte = decoded.bytes[0];
            const hashBytes = decoded.bytes.slice(1);

            let drep;
            if (credTypeByte === 0x22 || credTypeByte === 0x02) {
              drep = CSL.DRep.new_key_hash(CSL.Ed25519KeyHash.from_bytes(hashBytes));
            } else if (credTypeByte === 0x23 || credTypeByte === 0x03) {
              drep = CSL.DRep.new_script_hash(CSL.ScriptHash.from_bytes(hashBytes));
            } else {
              drep = CSL.DRep.new_key_hash(CSL.Ed25519KeyHash.from_bytes(decoded.bytes));
            }

            return CSL.Certificate.new_vote_delegation(
              CSL.VoteDelegation.new(stakeCred, drep)
            );
          }

          if (idPrefix === "pool") {
            const decoded = bech32Decode(delegationId);
            const poolKeyHash = CSL.Ed25519KeyHash.from_bytes(decoded.bytes);
            return CSL.Certificate.new_stake_delegation(
              CSL.StakeDelegation.new(stakeCred, poolKeyHash)
            );
          }

          throw new Error("Unrecognised ID format. Expected drep1... or pool1... prefix.");
        }

        async submitDelegationTx(delegationIds, cip20Msg) {
          const CSL = await getCSL();
          const api = this.state.walletApi;

          if (!api) {
            this.setDelegationStatus("Please connect your wallet first.", true);
            return;
          }
          if (!CSL) {
            this.setDelegationStatus(
              "Transaction library is still loading. Please wait a moment and try again.",
              true
            );
            return;
          }

          this.setDelegationStatus("Building transaction...");

          const currentSlot = getCurrentSlot();
          const utxoHexList = (await api.getUtxos()) || [];
          const changeAddrHex = await api.getChangeAddress();
          const rewardAddrHexList = (await api.getRewardAddresses()) || [];

          if (!rewardAddrHexList.length) {
            this.setDelegationStatus(
              "No stake/reward address found in wallet. Ensure your wallet has a registered stake key.",
              true
            );
            return;
          }

          const rewardAddr = CSL.RewardAddress.from_address(
            CSL.Address.from_bytes(hexToUint8Array(rewardAddrHexList[0]))
          );
          if (!rewardAddr) {
            this.setDelegationStatus("Could not parse reward address.", true);
            return;
          }
          const stakeCred = rewardAddr.payment_cred();

          const linearFee = CSL.LinearFee.new(
            CSL.BigNum.from_str(PROTOCOL_PARAMS.minFeeA),
            CSL.BigNum.from_str(PROTOCOL_PARAMS.minFeeB)
          );

          const txBuilderCfg = CSL.TransactionBuilderConfigBuilder.new()
            .fee_algo(linearFee)
            .pool_deposit(CSL.BigNum.from_str(PROTOCOL_PARAMS.poolDeposit))
            .key_deposit(CSL.BigNum.from_str(PROTOCOL_PARAMS.keyDeposit))
            .coins_per_utxo_byte(CSL.BigNum.from_str(PROTOCOL_PARAMS.coinsPerUtxoByte))
            .max_value_size(PROTOCOL_PARAMS.maxValSize)
            .max_tx_size(PROTOCOL_PARAMS.maxTxSize)
            .build();

          const txBuilder = CSL.TransactionBuilder.new(txBuilderCfg);
          const certs = CSL.Certificates.new();
          for (const delegationId of delegationIds) {
            certs.add(this.createDelegationCertificate(CSL, stakeCred, delegationId));
          }
          txBuilder.set_certs(certs);

          const metadataMap = CSL.MetadataMap.new();
          const msgList = CSL.MetadataList.new();
          for (const chunk of splitCip20Message(cip20Msg, 64)) {
            msgList.add(CSL.TransactionMetadatum.new_text(chunk));
          }
          metadataMap.insert(
            CSL.TransactionMetadatum.new_text("msg"),
            CSL.TransactionMetadatum.new_list(msgList)
          );

          const auxData = CSL.AuxiliaryData.new();
          const metadata = CSL.GeneralTransactionMetadata.new();
          metadata.insert(CSL.BigNum.from_str("674"), CSL.TransactionMetadatum.new_map(metadataMap));
          auxData.set_metadata(metadata);
          txBuilder.set_auxiliary_data(auxData);

          const utxos = CSL.TransactionUnspentOutputs.new();
          for (const hex of utxoHexList) {
            utxos.add(CSL.TransactionUnspentOutput.from_bytes(hexToUint8Array(hex)));
          }

          txBuilder.set_ttl(currentSlot + 7200);
          txBuilder.add_inputs_from(utxos, CSL.CoinSelectionStrategyCIP2.LargestFirst);
          txBuilder.add_change_if_needed(CSL.Address.from_bytes(hexToUint8Array(changeAddrHex)));

          const unsignedTx = txBuilder.build_tx();
          const unsignedTxHex = uint8ArrayToHex(unsignedTx.to_bytes());

          this.setDelegationStatus("Please sign the transaction in your wallet...");
          const witnessHex = await api.signTx(unsignedTxHex, true);

          const witnessSet = CSL.TransactionWitnessSet.from_bytes(hexToUint8Array(witnessHex));
          const signedTx = CSL.Transaction.new(
            unsignedTx.body(),
            witnessSet,
            unsignedTx.auxiliary_data()
          );
          const signedTxHex = uint8ArrayToHex(signedTx.to_bytes());

          this.setDelegationStatus("Submitting transaction...");
          const txHash = await api.submitTx(signedTxHex);
          this.setDelegationStatus(
            `Delegation submitted! TX: <a href="https://cardanoscan.io/transaction/${encodeURIComponent(
              txHash
            )}" target="_blank" rel="noreferrer noopener">${txHash}</a>`
          );
        }

        pickRandomChoices() {
          const entities = Array.isArray(this.state.entities) ? this.state.entities : [];
          const drepCandidates = entities.filter((entity) => typeof entity.drepId === "string");
          const spoCandidates = entities.filter((entity) => typeof entity.spoId === "string");

          const drepEntity = drepCandidates.length
            ? drepCandidates[Math.floor(Math.random() * drepCandidates.length)]
            : null;
          const spoEntity = spoCandidates.length
            ? spoCandidates[Math.floor(Math.random() * spoCandidates.length)]
            : null;

          const nowTs = new Date().toISOString();
          this.state.randomDrep = drepEntity
            ? { ...drepEntity, id: drepEntity.drepId, timestamp: nowTs }
            : null;
          this.state.randomSpo = spoEntity
            ? { ...spoEntity, id: spoEntity.spoId, timestamp: nowTs }
            : null;
        }

        openRandomPopup() {
          this.pickRandomChoices();
          this.state.showRandomPopup = true;
          this.render();
        }

        closeRandomPopup() {
          this.state.showRandomPopup = false;
          this.render();
        }

        openEntriesPopup() {
          this.state.showEntriesPopup = true;
          this.render();
        }

        closeEntriesPopup() {
          this.state.showEntriesPopup = false;
          this.render();
        }

        openEntityDetailPopup(entity) {
          this.state.detailEntity = entity;
          this.state.showEntityDetailPopup = true;
          this.render();
        }

        closeEntityDetailPopup() {
          this.state.showEntityDetailPopup = false;
          this.state.detailEntity = null;
          this.render();
        }

        openAboutPopup() {
          this.state.showAboutPopup = true;
          this.render();
        }

        closeAboutPopup() {
          this.state.showAboutPopup = false;
          this.render();
        }

        async delegate(entry, cip20MsgOverride) {
          if (!entry || !entry.id) return;
          try {
            const cip20Msg = cip20MsgOverride || this.getSingleDelegationMessage(entry);
            await this.submitDelegationTx([entry.id], cip20Msg);
          } catch (err) {
            const msg =
              err && typeof err === "object" && err.message ? err.message : String(err);
            this.setDelegationStatus(`Delegation failed: ${msg}`, true);
          }
        }

        async delegateBoth(drepEntry, spoEntry, cip20Msg) {
          if (!drepEntry?.id || !spoEntry?.id) return;

          try {
            await this.submitDelegationTx([drepEntry.id, spoEntry.id], cip20Msg);
          } catch (err) {
            const msg =
              err && typeof err === "object" && err.message ? err.message : String(err);
            this.setDelegationStatus(`Delegation failed: ${msg}`, true);
          }
        }

        navigateNextOldest() {
          this.state.index = Math.min(this.state.index + 1, this.state.snapshots.length - 1);
          this.render();
        }

        navigateCurrent() {
          this.state.index = 0;
          this.render();
        }

        render() {
          const root = this.shadowRoot;
          if (!root) return;

          const {
            loading,
            error,
            entities,
            snapshots,
            index,
            walletsAvailable,
            walletConnected,
            connectedWalletName,
            connectedAddress,
            walletError,
            delegationStatus,
            delegationIsError,
            showRandomPopup,
            randomDrep,
            randomSpo,
            showEntriesPopup,
            showEntityDetailPopup,
            detailEntity,
            showAboutPopup
          } = this.state;

          const style = `
            <style>
              .header {
                margin-bottom: 18px;
                position: relative;
              }
              h1 {
                font-size: clamp(1.35rem, 2.2vw, 2rem);
                margin: 0 0 8px;
                line-height: 1.2;
              }
              .about-btn {
                position: absolute;
                top: 0;
                right: 0;
                border-radius: 50%;
                width: 36px;
                height: 36px;
                border: 1px solid var(--line);
                background: var(--card);
                color: var(--text);
                font-size: 1.1rem;
                cursor: pointer;
                display: grid;
                place-items: center;
                line-height: 1;
              }
              .about-btn:hover {
                background: color-mix(in srgb, var(--accent) 14%, transparent);
                border-color: color-mix(in srgb, var(--accent) 44%, var(--line));
              }
              .about-links {
                list-style: none;
                padding: 0;
                margin: 14px 0 0;
              }
              .about-links li {
                margin: 10px 0;
                line-height: 1.5;
              }
              .about-links a {
                color: var(--accent);
                text-decoration: none;
              }
              .about-links a:hover {
                text-decoration: underline;
              }
              .about-section {
                margin-top: 16px;
                padding-top: 14px;
                border-top: 1px solid var(--line);
              }
              .about-section p {
                margin: 6px 0;
                font-size: 0.92rem;
                color: var(--muted);
                line-height: 1.5;
              }
              .subtitle {
                color: var(--muted);
                margin: 0;
              }
              .wallet-row {
                margin-top: 12px;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 10px;
              }
              .wallet-btn {
                border-radius: 10px;
                padding: 10px 14px;
                border: 1px solid var(--line);
                cursor: pointer;
                background: color-mix(in srgb, var(--accent) 22%, transparent);
                border-color: color-mix(in srgb, var(--accent) 44%, var(--line));
                color: var(--text);
                font-size: 0.9rem;
              }
              .wallet-note {
                color: var(--muted);
                font-size: 0.88rem;
              }
              .wallet-address {
                width: 100%;
                font-size: 0.82rem;
                color: var(--muted);
                margin: 2px 0 0;
                word-break: break-all;
              }
              .wallet-error {
                width: 100%;
                margin: 2px 0 0;
                color: #f97316;
                font-size: 0.85rem;
              }
              .wallet-picker {
                width: 100%;
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
              }
              .wallet-picker-label {
                width: 100%;
                font-size: 0.88rem;
                color: var(--muted);
                margin-bottom: 2px;
              }
              .wallet-option {
                border-radius: 10px;
                padding: 8px 14px;
                border: 1px solid var(--line);
                cursor: pointer;
                background: var(--card);
                color: var(--text);
                font-size: 0.88rem;
                display: flex;
                align-items: center;
                gap: 8px;
              }
              .wallet-option:hover {
                background: color-mix(in srgb, var(--accent) 14%, transparent);
                border-color: color-mix(in srgb, var(--accent) 44%, var(--line));
              }
              .wallet-option img {
                width: 24px;
                height: 24px;
                border-radius: 4px;
              }
              .grid {
                display: grid;
                grid-template-columns: 1fr;
                row-gap: clamp(26px, 5vh, 48px);
                column-gap: 14px;
                align-items: start;
              }
              .utility-row {
                margin-top: 18px;
                display: flex;
                justify-content: center;
                gap: 10px;
                flex-wrap: wrap;
              }
              .utility-trigger {
                border-radius: 10px;
                padding: 10px 14px;
                border: 1px solid var(--line);
                cursor: pointer;
                background: color-mix(in srgb, var(--accent) 22%, transparent);
                border-color: color-mix(in srgb, var(--accent) 44%, var(--line));
                color: var(--text);
                font-size: 0.9rem;
              }
              .delegate-both {
                border-radius: 10px;
                padding: 10px 14px;
                border: 1px solid var(--line);
                cursor: pointer;
                background: color-mix(in srgb, var(--accent-2) 24%, transparent);
                border-color: color-mix(in srgb, var(--accent-2) 44%, var(--line));
                color: var(--text);
                font-size: 0.9rem;
              }
              .delegate-both:disabled {
                opacity: 0.45;
                cursor: not-allowed;
              }
              .pair-actions {
                margin-top: 12px;
                display: flex;
                justify-content: center;
              }
              .modal-pair-actions {
                margin-top: clamp(28px, 7vh, 72px);
              }
              @media (min-width: 768px) {
                .grid {
                  grid-template-columns: 1fr 1fr;
                  row-gap: 18px;
                }
              }
              .modal-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(2, 6, 23, 0.7);
                display: grid;
                place-items: center;
                padding: 20px;
                z-index: 999;
              }
              .modal {
                width: min(920px, 92vw);
                max-height: 92vh;
                overflow: auto;
                background: var(--bg);
                border: 1px solid var(--line);
                border-radius: 16px;
                padding: 16px;
              }
              .modal-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
              }
              .modal-head h2 {
                margin: 0;
                font-size: 1.2rem;
              }
              .modal-close,
              .modal-spin {
                border-radius: 10px;
                padding: 10px 14px;
                border: 1px solid var(--line);
                cursor: pointer;
                background: transparent;
                color: var(--text);
                font-size: 0.9rem;
              }
              .modal-grid {
                display: grid;
                grid-template-columns: 1fr;
                row-gap: clamp(26px, 5vh, 48px);
                column-gap: 14px;
                width: 100%;
              }
              .modal-grid > * {
                min-width: 0;
              }
              @media (min-width: 768px) {
                .modal-grid {
                  grid-template-columns: 1fr 1fr;
                  row-gap: 18px;
                }
              }
              @media (max-width: 767px) {
                .modal {
                  width: 90vw;
                  padding: 12px;
                }
              }
              .modal-actions {
                margin-top: clamp(28px, 6vh, 64px);
                display: flex;
                justify-content: center;
              }
              .modal-empty {
                color: var(--muted);
                text-align: center;
                margin-top: 8px;
              }
              .entries-table-wrap {
                margin-top: 8px;
                overflow-x: auto;
              }
              .entries-table {
                width: 100%;
                border-collapse: collapse;
              }
              .entries-table th,
              .entries-table td {
                border: 1px solid var(--line);
                padding: 8px 10px;
                text-align: left;
                vertical-align: top;
                font-size: 0.9rem;
              }
              .entries-table th {
                color: var(--muted);
              }
              .entry-view-btn {
                border-radius: 8px;
                padding: 6px 10px;
                border: 1px solid var(--line);
                background: transparent;
                color: var(--text);
                cursor: pointer;
              }
              .detail-id {
                display: block;
                margin: 8px 0;
                font-size: 0.85rem;
                color: var(--muted);
                word-break: break-all;
              }
              .detail-links {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin: 10px 0 2px;
              }
              .detail-links a {
                color: var(--text);
              }
              .detail-actions {
                margin-top: 14px;
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
              }
              .detail-actions button {
                border-radius: 10px;
                padding: 10px 14px;
                border: 1px solid var(--line);
                background: transparent;
                color: var(--text);
                cursor: pointer;
              }
              .footer {
                margin-top: clamp(42px, 9vh, 110px);
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
                align-items: center;
                justify-content: center;
              }
              .footer button {
                border-radius: 10px;
                padding: 10px 14px;
                border: 1px solid var(--line);
                cursor: pointer;
                background: transparent;
                color: var(--text);
              }
              .footer .primary {
                background: color-mix(in srgb, var(--accent-2) 22%, transparent);
                border-color: color-mix(in srgb, var(--accent-2) 44%, var(--line));
              }
              .status {
                color: var(--muted);
                font-size: 0.9rem;
                width: 100%;
                text-align: center;
              }
              .panel {
                border: 1px solid var(--line);
                border-radius: var(--radius);
                padding: 16px;
                background: var(--card);
                color: var(--text);
              }
              .delegation-status {
                margin-top: 14px;
                padding: 12px 16px;
                border-radius: 10px;
                font-size: 0.9rem;
                word-break: break-all;
              }
              .delegation-status.info {
                background: color-mix(in srgb, var(--accent) 12%, transparent);
                border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
                color: var(--text);
              }
              .delegation-status.error {
                background: color-mix(in srgb, #ef4444 12%, transparent);
                border: 1px solid color-mix(in srgb, #ef4444 30%, var(--line));
                color: #fca5a5;
              }
            </style>
          `;

          if (loading) {
            root.innerHTML = `${style}<section class="panel">Loading...</section>`;
            return;
          }

          if (error) {
            root.innerHTML = `${style}<section class="panel">Error: ${error}</section>`;
            return;
          }

          const snapshot = snapshots[index] || { drep: null, spo: null };
          const statusText = snapshots.length
            ? `Showing entry set ${index + 1} of ${snapshots.length}`
            : "No entries available";
          const { showingWalletPicker } = this.state;

          const walletSummary = walletConnected
            ? `Connected: ${connectedWalletName || "Unknown"}`
            : walletsAvailable.length
              ? "Wallet not connected"
              : "No wallet extension detected";

          const walletPickerHtml = showingWalletPicker && !walletConnected
            ? `<div class="wallet-picker">
                <span class="wallet-picker-label">Select a wallet:</span>
                ${walletsAvailable.map((w) =>
                  `<button class="wallet-option" data-wallet-key="${w.key}" type="button">${
                    w.api.icon ? `<img src="${w.api.icon}" alt="">` : ""
                  }${w.name}</button>`
                ).join("")}
              </div>`
            : "";

          const randomAvailable = entities.some((entity) => typeof entity.drepId === "string") ||
            entities.some((entity) => typeof entity.spoId === "string");

          const entriesTableRows = entities
            .map((entity, idx) => {
              const drepCheck = typeof entity.drepId === "string" ? `<span style="color:var(--accent-2)">&#10003;</span>` : "";
              const spoCheck = typeof entity.spoId === "string" ? `<span style="color:var(--accent-2)">&#10003;</span>` : "";
              return `<tr><td>${entity.name || "Unnamed"}</td><td><button class="entry-view-btn" data-entity-index="${idx}" type="button">View</button></td><td style="text-align:center">${drepCheck}</td><td style="text-align:center">${spoCheck}</td></tr>`;
            })
            .join("");

          const popupHtml = showRandomPopup
            ? `<div class="modal-backdrop" id="random-modal-backdrop">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="random-modal-title">
                  <div class="modal-head">
                    <h2 id="random-modal-title">Choose Random DRep & SPO</h2>
                    <button id="random-close" class="modal-close" type="button">Close</button>
                  </div>
                  <div class="modal-grid">
                    <dotm-card id="random-spo-card"></dotm-card>
                    <dotm-card id="random-drep-card"></dotm-card>
                  </div>
                  <div class="pair-actions modal-pair-actions">
                    <button id="random-delegate-both" class="delegate-both" type="button" ${walletConnected && randomDrep && randomSpo ? "" : "disabled"}>Delegate to Both</button>
                  </div>
                  ${randomAvailable ? "" : `<p class="modal-empty">No entities are available for random selection.</p>`}
                  <div class="modal-actions">
                    <button id="random-spin" class="modal-spin" type="button">Spin Again</button>
                  </div>
                </div>
              </div>`
            : "";

          const entriesPopupHtml = showEntriesPopup
            ? `<div class="modal-backdrop" id="entries-modal-backdrop">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="entries-modal-title">
                  <div class="modal-head">
                    <h2 id="entries-modal-title">All Entries</h2>
                    <button id="entries-close" class="modal-close" type="button">Close</button>
                  </div>
                  <div class="entries-table-wrap">
                    <table class="entries-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Actions</th>
                          <th>DRep</th>
                          <th>SPO</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${entriesTableRows || `<tr><td colspan="4">No entries available.</td></tr>`}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>`
            : "";

          const detailPrimaryId = detailEntity
            ? (typeof detailEntity.drepId === "string" ? detailEntity.drepId : detailEntity.spoId)
            : null;
          const detailDrepLink = detailEntity && typeof detailEntity.drepId === "string"
            ? `https://cardanoscan.io/dRep/${encodeURIComponent(detailEntity.drepId)}`
            : null;
          const detailSpoLink = detailEntity && typeof detailEntity.spoId === "string"
            ? `https://cardanoscan.io/pool/${encodeURIComponent(detailEntity.spoId)}`
            : null;

          const detailPopupHtml = showEntityDetailPopup && detailEntity
            ? `<div class="modal-backdrop" id="entity-detail-backdrop">
                <div class="modal" role="dialog" aria-modal="true" aria-labelledby="entity-detail-title">
                  <div class="modal-head">
                    <h2 id="entity-detail-title">${detailEntity.name || "Entity Details"}</h2>
                    <button id="entity-detail-close" class="modal-close" type="button">Close</button>
                  </div>
                  ${detailPrimaryId ? `<dotm-qr value="${detailPrimaryId}"></dotm-qr>` : ""}
                  ${detailEntity.drepId ? `<small class="detail-id">DRep ID: ${detailEntity.drepId}</small>` : ""}
                  ${detailEntity.spoId ? `<small class="detail-id">SPO ID: ${detailEntity.spoId}</small>` : ""}
                  <div class="detail-links">
                    ${detailDrepLink ? `<a href="${detailDrepLink}" target="_blank" rel="noreferrer noopener">DRep on CardanoScan</a>` : ""}
                    ${detailSpoLink ? `<a href="${detailSpoLink}" target="_blank" rel="noreferrer noopener">SPO on CardanoScan</a>` : ""}
                  </div>
                  ${
                    Array.isArray(detailEntity.bulletPoints) && detailEntity.bulletPoints.length
                      ? `<ul>${detailEntity.bulletPoints.map((item) => `<li>${item}</li>`).join("")}</ul>`
                      : `<p class="modal-empty">No notes yet.</p>`
                  }
                  ${
                    Array.isArray(detailEntity.socials) && detailEntity.socials.length
                      ? `<div class="detail-links">${detailEntity.socials
                          .map((s) => `<a href="${s.url}" target="_blank" rel="noreferrer noopener">${s.platform || "social"}</a>`)
                          .join("")}</div>`
                      : ""
                  }
                  <div class="detail-actions">
                    ${
                      typeof detailEntity.drepId === "string"
                        ? `<button id="detail-delegate-drep" type="button" ${walletConnected ? "" : "disabled"}>Delegate as DRep</button>`
                        : ""
                    }
                    ${
                      typeof detailEntity.spoId === "string"
                        ? `<button id="detail-delegate-spo" type="button" ${walletConnected ? "" : "disabled"}>Delegate as SPO</button>`
                        : ""
                    }
                    ${
                      typeof detailEntity.drepId === "string" && typeof detailEntity.spoId === "string"
                        ? `<button id="detail-delegate-both" class="delegate-both" type="button" ${walletConnected ? "" : "disabled"}>Delegate as Both</button>`
                        : ""
                    }
                  </div>
                </div>
              </div>`
            : "";

          root.innerHTML = `
            ${style}
            <section class="header">
              <button id="open-about" class="about-btn" type="button" title="About this project">?</button>
              <h1>DRep & SPO of the Month</h1>
              <p class="subtitle">Scan the QR code or use the delegate button to support this month's featured members.</p>
              <div class="wallet-row">
                <button id="connect-wallet" class="wallet-btn" type="button">${walletConnected ? "Wallet Connected" : "Connect Wallet"}</button>
                <span class="wallet-note">${walletSummary}</span>
                ${walletConnected ? `<p class="wallet-address">Address: ${connectedAddress}</p>` : ""}
                ${walletError ? `<p class="wallet-error">${walletError}</p>` : ""}
                ${walletPickerHtml}
              </div>
              ${delegationStatus ? `<div class="delegation-status ${delegationIsError ? "error" : "info"}">${delegationStatus}</div>` : ""}
            </section>
            <section class="grid">
              <dotm-card id="spo-card"></dotm-card>
              <dotm-card id="drep-card"></dotm-card>
            </section>
            <section class="pair-actions">
              <button id="month-delegate-both" class="delegate-both" type="button" ${walletConnected && snapshot.drep && snapshot.spo ? "" : "disabled"}>Delegate to Both</button>
            </section>
            <section class="utility-row">
              <button id="open-random" class="utility-trigger" type="button">Choose Random DRep and SPO</button>
              <button id="open-entries" class="utility-trigger" type="button">View All Entries</button>
            </section>
            <section class="footer">
              <button id="previous" class="primary" type="button">Previous Entries</button>
              <button id="current" type="button">Current</button>
              <span class="status">${statusText}</span>
            </section>
            ${popupHtml}
            ${entriesPopupHtml}
            ${detailPopupHtml}
            ${showAboutPopup
              ? `<div class="modal-backdrop" id="about-modal-backdrop">
                  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="about-modal-title" style="max-width:560px">
                    <div class="modal-head">
                      <h2 id="about-modal-title">About This Project</h2>
                      <button id="about-close" class="modal-close" type="button">Close</button>
                    </div>
                    <p style="margin:8px 0;font-size:0.92rem;color:var(--muted)">A community tool for discovering and delegating to Cardano DReps and Stake Pool Operators.</p>
                    <ul class="about-links">
                      <li><a href="https://github.com/willpiam/drep-of-the-month" target="_blank" rel="noreferrer noopener">GitHub Repository</a></li>
                      <li><a href="https://projects.williamdoyle.ca" target="_blank" rel="noreferrer noopener">Other Projects by William</a></li>
                      <li><a href="https://app.ens.domains/williamdoyle.eth" target="_blank" rel="noreferrer noopener">williamdoyle.eth</a> (includes a Cardano address for tips)</li>
                      <li>Tips also accepted via ADA Handle: <a href="https://handle.me/wildoy" target="_blank" rel="noreferrer noopener">$wildoy</a></li>
                    </ul>
                    <div class="about-section">
                      <p><strong>Contact / Nominations</strong></p>
                      <p>Want to be added to the list, nominate someone, or report a bug? Reach out on <a href="https://x.com/william00000010" target="_blank" rel="noreferrer noopener">X (Twitter)</a>.</p>
                    </div>
                    <div class="about-section">
                      <p><strong>Delegate to the creator</strong></p>
                      <p>William is a DRep under the ADA Handle <a href="https://handle.me/computerman" target="_blank" rel="noreferrer noopener">$computerman</a>.</p>
                      <p>DRep ID: <a href="https://cardanoscan.io/dRep/drep1yfpgzfymq6tt9c684e7vzata8r5pl4w84fmrjqeztdqw0sgpzw3nt" target="_blank" rel="noreferrer noopener">drep1yfpgzfymq6tt9c684e7vzata8r5pl4w84fmrjqeztdqw0sgpzw3nt</a></p>
                      <div style="margin-top:10px">
                        <button id="about-delegate-creator" type="button" ${walletConnected ? "" : "disabled"} title="${walletConnected ? "" : "Connect wallet to delegate"}" style="border-radius:10px;padding:10px 14px;border:1px solid var(--line);cursor:pointer;background:color-mix(in srgb, var(--accent) 22%, transparent);border-color:color-mix(in srgb, var(--accent) 44%, var(--line));color:var(--text);font-size:0.9rem">Delegate to William as DRep</button>
                      </div>
                    </div>
                  </div>
                </div>`
              : ""
            }
          `;

          const spoCard = root.getElementById("spo-card");
          const drepCard = root.getElementById("drep-card");
          const previousButton = root.getElementById("previous");
          const currentButton = root.getElementById("current");
          const connectWalletButton = root.getElementById("connect-wallet");
          const monthDelegateBothButton = root.getElementById("month-delegate-both");
          const openRandomButton = root.getElementById("open-random");
          const openEntriesButton = root.getElementById("open-entries");
          const randomCloseButton = root.getElementById("random-close");
          const randomSpinButton = root.getElementById("random-spin");
          const randomDelegateBothButton = root.getElementById("random-delegate-both");
          const randomDrepCard = root.getElementById("random-drep-card");
          const randomSpoCard = root.getElementById("random-spo-card");
          const entriesCloseButton = root.getElementById("entries-close");
          const entityDetailCloseButton = root.getElementById("entity-detail-close");
          const detailDelegateDrepButton = root.getElementById("detail-delegate-drep");
          const detailDelegateSpoButton = root.getElementById("detail-delegate-spo");
          const detailDelegateBothButton = root.getElementById("detail-delegate-both");

          if (spoCard) {
            spoCard.data = {
              sectionTitle: "SPO of the Month",
              entry: snapshot.spo,
              walletConnected,
              onDelegate: (entry) => this.delegate(entry, this.getSingleDelegationMessage(entry))
            };
          }

          if (drepCard) {
            drepCard.data = {
              sectionTitle: "DRep of the Month",
              entry: snapshot.drep,
              walletConnected,
              onDelegate: (entry) => this.delegate(entry, this.getSingleDelegationMessage(entry))
            };
          }

          if (previousButton) {
            previousButton.disabled = index >= snapshots.length - 1 || snapshots.length === 0;
            previousButton.addEventListener("click", () => this.navigateNextOldest());
          }

          if (currentButton) {
            currentButton.disabled = index === 0;
            currentButton.addEventListener("click", () => this.navigateCurrent());
          }

          if (connectWalletButton) {
            connectWalletButton.disabled = walletConnected;
            connectWalletButton.addEventListener("click", () => this.showWalletPicker());
          }

          if (monthDelegateBothButton) {
            monthDelegateBothButton.addEventListener("click", () => {
              if (!snapshot.drep || !snapshot.spo) return;
              const period = this.formatMonthYear(snapshot.drep.timestamp || snapshot.spo.timestamp);
              this.delegateBoth(
                snapshot.drep,
                snapshot.spo,
                `Delegate to DRep and SPO of the month for ${period}`
              );
            });
          }

          if (openRandomButton) {
            openRandomButton.addEventListener("click", () => this.openRandomPopup());
          }

          if (openEntriesButton) {
            openEntriesButton.addEventListener("click", () => this.openEntriesPopup());
          }

          if (randomCloseButton) {
            randomCloseButton.addEventListener("click", () => this.closeRandomPopup());
          }

          if (randomSpinButton) {
            randomSpinButton.addEventListener("click", () => {
              this.pickRandomChoices();
              this.render();
            });
          }

          if (randomDelegateBothButton) {
            randomDelegateBothButton.addEventListener("click", () => {
              if (!randomDrep || !randomSpo) return;
              this.delegateBoth(randomDrep, randomSpo, "Delegate to random DRep and SPO");
            });
          }

          if (entriesCloseButton) {
            entriesCloseButton.addEventListener("click", () => this.closeEntriesPopup());
          }

          if (randomDrepCard) {
            randomDrepCard.data = {
              sectionTitle: "Random DRep",
              entry: randomDrep,
              walletConnected,
              onDelegate: (entry) => this.delegate(entry, "Delegate to random DRep")
            };
          }

          if (randomSpoCard) {
            randomSpoCard.data = {
              sectionTitle: "Random SPO",
              entry: randomSpo,
              walletConnected,
              onDelegate: (entry) => this.delegate(entry, "Delegate to random SPO")
            };
          }

          root.querySelectorAll(".entry-view-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
              const idx = Number(btn.getAttribute("data-entity-index"));
              if (!Number.isNaN(idx) && entities[idx]) this.openEntityDetailPopup(entities[idx]);
            });
          });

          if (entityDetailCloseButton) {
            entityDetailCloseButton.addEventListener("click", () => this.closeEntityDetailPopup());
          }

          if (detailDelegateDrepButton && detailEntity?.drepId) {
            detailDelegateDrepButton.addEventListener("click", () =>
              this.delegate(
                { ...detailEntity, id: detailEntity.drepId, timestamp: new Date().toISOString() },
                `Delegate to ${detailEntity.name || "entity"} as DRep`
              )
            );
          }

          if (detailDelegateSpoButton && detailEntity?.spoId) {
            detailDelegateSpoButton.addEventListener("click", () =>
              this.delegate(
                { ...detailEntity, id: detailEntity.spoId, timestamp: new Date().toISOString() },
                `Delegate to ${detailEntity.name || "entity"} as SPO`
              )
            );
          }

          if (detailDelegateBothButton && detailEntity?.drepId && detailEntity?.spoId) {
            detailDelegateBothButton.addEventListener("click", () =>
              this.delegateBoth(
                { ...detailEntity, id: detailEntity.drepId, timestamp: new Date().toISOString() },
                { ...detailEntity, id: detailEntity.spoId, timestamp: new Date().toISOString() },
                `Delegate to ${detailEntity.name || "entity"} as DRep and SPO`
              )
            );
          }

          root.querySelectorAll(".wallet-option").forEach((btn) => {
            btn.addEventListener("click", () => {
              const key = btn.getAttribute("data-wallet-key");
              if (key) this.connectWallet(key);
            });
          });

          const openAboutButton = root.getElementById("open-about");
          const aboutCloseButton = root.getElementById("about-close");
          const aboutDelegateCreatorButton = root.getElementById("about-delegate-creator");

          if (openAboutButton) {
            openAboutButton.addEventListener("click", () => this.openAboutPopup());
          }

          if (aboutCloseButton) {
            aboutCloseButton.addEventListener("click", () => this.closeAboutPopup());
          }

          if (aboutDelegateCreatorButton) {
            aboutDelegateCreatorButton.addEventListener("click", () => {
              this.delegate(
                { id: "drep1yfpgzfymq6tt9c684e7vzata8r5pl4w84fmrjqeztdqw0sgpzw3nt", name: "William", timestamp: new Date().toISOString() },
                "Delegate to William ($computerman) as DRep"
              );
            });
          }
        }
      }
      customElements.define("dotm-app", DotmApp);
