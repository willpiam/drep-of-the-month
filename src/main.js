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
            randomSpo: null
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

        async delegate(entry) {
          if (!entry || !entry.id) return;
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

          try {
            /* 1. Local protocol params + slot (no external API needed) */
            const currentSlot = getCurrentSlot();

            /* 2. Wallet data */
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

            /* 3. Derive stake credential from reward address */
            const rewardAddr = CSL.RewardAddress.from_address(
              CSL.Address.from_bytes(hexToUint8Array(rewardAddrHexList[0]))
            );
            if (!rewardAddr) {
              this.setDelegationStatus("Could not parse reward address.", true);
              return;
            }
            const stakeCred = rewardAddr.payment_cred();

            /* 4. Build the appropriate certificate */
            let cert;
            const idPrefix = entry.id.split("1")[0];

            if (idPrefix === "drep") {
              /* DRep vote delegation (Conway era) */
              const decoded = bech32Decode(entry.id);
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

              cert = CSL.Certificate.new_vote_delegation(
                CSL.VoteDelegation.new(stakeCred, drep)
              );
            } else if (idPrefix === "pool") {
              /* SPO stake delegation */
              const decoded = bech32Decode(entry.id);
              const poolKeyHash = CSL.Ed25519KeyHash.from_bytes(decoded.bytes);
              cert = CSL.Certificate.new_stake_delegation(
                CSL.StakeDelegation.new(stakeCred, poolKeyHash)
              );
            } else {
              this.setDelegationStatus(
                "Unrecognised ID format. Expected drep1... or pool1... prefix.",
                true
              );
              return;
            }

            /* 5. Build transaction */
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
            certs.add(cert);
            txBuilder.set_certs(certs);

            /* CIP-20 transaction message (metadata label 674) */
            const entryDate = new Date(entry.timestamp);
            const monthName = entryDate.toLocaleString(undefined, { month: "long", timeZone: "UTC" });
            const year = entryDate.getUTCFullYear();
            const delegType = idPrefix === "drep" ? "DRep" : "SPO";
            const cip20Msg = `Delegate to ${delegType} of the month for ${monthName} ${year}`;

            const metadataMap = CSL.MetadataMap.new();
            const msgList = CSL.MetadataList.new();
            msgList.add(CSL.TransactionMetadatum.new_text(cip20Msg));
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

            /* 6. Sign */
            const witnessHex = await api.signTx(unsignedTxHex, true);

            /* 7. Assemble signed transaction */
            const witnessSet = CSL.TransactionWitnessSet.from_bytes(hexToUint8Array(witnessHex));
            const signedTx = CSL.Transaction.new(
              unsignedTx.body(),
              witnessSet,
              unsignedTx.auxiliary_data()
            );
            const signedTxHex = uint8ArrayToHex(signedTx.to_bytes());

            this.setDelegationStatus("Submitting transaction...");

            /* 8. Submit */
            const txHash = await api.submitTx(signedTxHex);
            this.setDelegationStatus(
              `Delegation submitted! TX: <a href="https://cardanoscan.io/transaction/${encodeURIComponent(
                txHash
              )}" target="_blank" rel="noreferrer noopener">${txHash}</a>`
            );
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
            randomSpo
          } = this.state;

          const style = `
            <style>
              .header {
                margin-bottom: 18px;
              }
              h1 {
                font-size: clamp(1.35rem, 2.2vw, 2rem);
                margin: 0 0 8px;
                line-height: 1.2;
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
              .random-row {
                margin-top: 18px;
                display: flex;
                justify-content: center;
              }
              .random-trigger {
                border-radius: 10px;
                padding: 10px 14px;
                border: 1px solid var(--line);
                cursor: pointer;
                background: color-mix(in srgb, var(--accent) 22%, transparent);
                border-color: color-mix(in srgb, var(--accent) 44%, var(--line));
                color: var(--text);
                font-size: 0.9rem;
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
                width: min(980px, 96vw);
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
                gap: 14px;
              }
              @media (min-width: 768px) {
                .modal-grid {
                  grid-template-columns: 1fr 1fr;
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
                  ${randomAvailable ? "" : `<p class="modal-empty">No entities are available for random selection.</p>`}
                  <div class="modal-actions">
                    <button id="random-spin" class="modal-spin" type="button">Spin Again</button>
                  </div>
                </div>
              </div>`
            : "";

          root.innerHTML = `
            ${style}
            <section class="header">
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
            <section class="random-row">
              <button id="open-random" class="random-trigger" type="button">Choose Random DRep and SPO</button>
            </section>
            <section class="footer">
              <button id="previous" class="primary" type="button">Previous Entries</button>
              <button id="current" type="button">Current</button>
              <span class="status">${statusText}</span>
            </section>
            ${popupHtml}
          `;

          const spoCard = root.getElementById("spo-card");
          const drepCard = root.getElementById("drep-card");
          const previousButton = root.getElementById("previous");
          const currentButton = root.getElementById("current");
          const connectWalletButton = root.getElementById("connect-wallet");
          const openRandomButton = root.getElementById("open-random");
          const randomCloseButton = root.getElementById("random-close");
          const randomSpinButton = root.getElementById("random-spin");
          const randomDrepCard = root.getElementById("random-drep-card");
          const randomSpoCard = root.getElementById("random-spo-card");

          if (spoCard) {
            spoCard.data = {
              sectionTitle: "SPO of the Month",
              entry: snapshot.spo,
              walletConnected,
              onDelegate: (entry) => this.delegate(entry)
            };
          }

          if (drepCard) {
            drepCard.data = {
              sectionTitle: "DRep of the Month",
              entry: snapshot.drep,
              walletConnected,
              onDelegate: (entry) => this.delegate(entry)
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

          if (openRandomButton) {
            openRandomButton.addEventListener("click", () => this.openRandomPopup());
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

          if (randomDrepCard) {
            randomDrepCard.data = {
              sectionTitle: "Random DRep",
              entry: randomDrep,
              walletConnected,
              onDelegate: (entry) => this.delegate(entry)
            };
          }

          if (randomSpoCard) {
            randomSpoCard.data = {
              sectionTitle: "Random SPO",
              entry: randomSpo,
              walletConnected,
              onDelegate: (entry) => this.delegate(entry)
            };
          }

          root.querySelectorAll(".wallet-option").forEach((btn) => {
            btn.addEventListener("click", () => {
              const key = btn.getAttribute("data-wallet-key");
              if (key) this.connectWallet(key);
            });
          });
        }
      }
      customElements.define("dotm-app", DotmApp);
