
        // ==========================================
        // 1. ESTADO GLOBAL E RECURSOS
        // ==========================================
        let port = null;
        let reader = null;
        let keepReading = false;
        let rxBuffer = new Uint8Array(0);
        let isSimulating = false;
        let simInterval = null;

        const PACKET_SIZE = 75; // Tamanho do pacote de realtime da Speeduino / Megasquirt (A Command)

        // ==========================================
        // 2. CONEXÃO E LEITURA WEB SERIAL
        // ==========================================
        async function toggleConnect() {
            if (port) {
                await disconnectSerial();
            } else {
                await connectSerial();
            }
        }

        async function connectSerial() {
            if (!("serial" in navigator)) {
                alert("Seu navegador não suporta a Web Serial API. Utilize o Google Chrome ou Microsoft Edge.");
                return;
            }

            try {
                // Solicita seleção da porta COM ao usuário
                port = await navigator.serial.requestPort();
                
                const baud = parseInt(document.getElementById('baudRate').value);
                await port.open({ baudRate: baud });

                updateStatus(true, "Conectado");
                document.getElementById('btnConnect').innerText = "Desconectar";
                document.getElementById('btnConnect').className = "btn-disconnect";

                keepReading = true;
                readSerialLoop();
            } catch (err) {
                console.error("Erro na conexão serial:", err);
                updateStatus(false, "Erro ao conectar");
            }
        }

        async function disconnectSerial() {
            keepReading = false;
            
            if (reader) {
                await reader.cancel();
                reader = null;
            }

            if (port) {
                await port.close();
                port = null;
            }

            updateStatus(false, "Desconectado");
            document.getElementById('btnConnect').innerText = "Conectar Serial";
            document.getElementById('btnConnect').className = "btn-connect";
        }

        async function readSerialLoop() {
            while (port && port.readable && keepReading) {
                try {
                    reader = port.readable.getReader();
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        if (value) {
                            appendBuffer(value);
                            processBuffer();
                        }
                    }
                } catch (error) {
                    console.error("Erro na leitura dos pacotes:", error);
                } finally {
                    if (reader) {
                        reader.releaseLock();
                    }
                }
            }
        }

        // ==========================================
        // 3. BUFFERING & PARSING DE PACOTES BINÁRIOS
        // ==========================================
        function appendBuffer(newBytes) {
            const merged = new Uint8Array(rxBuffer.length + newBytes.length);
            merged.set(rxBuffer, 0);
            merged.set(newBytes, rxBuffer.length);
            rxBuffer = merged;
        }

        function processBuffer() {
            // Processa enquanto houver pacotes de tamanho completo no buffer
            while (rxBuffer.length >= PACKET_SIZE) {
                // Extrai um pacote completo
                const packet = rxBuffer.slice(0, PACKET_SIZE);
                // Remove o pacote lido da fila
                rxBuffer = rxBuffer.slice(PACKET_SIZE);

                // Executa a decodificação dos bytes
                parseEcuPacket(packet);
            }
        }

        function parseEcuPacket(packet) {
            // Estrutura de bytes do protocolo Speeduino / Megasquirt (A Command)
            // Byte 0: status, Byte 1: TPS, Byte 2: CLT (+ offset), Byte 4/5: RPM, Byte 6: MAP, etc.
            
            const rpm = (packet[15] << 8) | packet[14];  // Exemplo de extração de uint16 (RPM)
            const map = (packet[5] << 8) | packet[4];    // MAP em kPa
            const tps = packet[24];                       // TPS em %
            const clt = packet[7] - 40;                  // Temperatura em °C (-40 offset)
            const afr = packet[10] / 10.0;               // AFR com escala de 1 casa decimal
            const bat = packet[9] / 10.0;                // Voltagem com escala

            // Atualiza a tela com os novos dados recebidos
            updateDashboard({
                rpm: isNaN(rpm) ? 0 : rpm,
                map: isNaN(map) ? 0 : map,
                tps: isNaN(tps) ? 0 : tps,
                clt: isNaN(clt) ? 0 : clt,
                afr: isNaN(afr) ? 14.7 : afr,
                bat: isNaN(bat) ? 12.0 : bat
            });
        }

        // ==========================================
        // 4. RENDERIZAÇÃO E ATUALIZAÇÃO DA INTERFACE
        // ==========================================
        function updateDashboard(data) {
            document.getElementById('valRPM').childNodes[0].nodeValue = data.rpm + " ";
            document.getElementById('valMAP').childNodes[0].nodeValue = data.map + " ";
            document.getElementById('valTPS').childNodes[0].nodeValue = data.tps;
            document.getElementById('valCLT').childNodes[0].nodeValue = data.clt + " ";
            document.getElementById('valAFR').childNodes[0].nodeValue = data.afr.toFixed(1) + " ";
            document.getElementById('valBAT').childNodes[0].nodeValue = data.bat.toFixed(1) + " ";

            drawGauge('gaugeRPM', data.rpm, 0, 8000, '#04d361');
            drawGauge('gaugeMAP', data.map, 0, 250, '#8257e5');
        }

        function drawGauge(canvasId, val, minVal, maxVal, color) {
            const canvas = document.getElementById(canvasId);
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            const cx = w / 2;
            const cy = h - 10;
            const radius = 75;

            ctx.clearRect(0, 0, w, h);

            // Fundo do arco
            ctx.beginPath();
            ctx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
            ctx.lineWidth = 14;
            ctx.strokeStyle = '#323238';
            ctx.stroke();

            // Arco de progresso
            const pct = Math.min(Math.max((val - minVal) / (maxVal - minVal), 0), 1);
            const angle = Math.PI + (pct * Math.PI);

            ctx.beginPath();
            ctx.arc(cx, cy, radius, Math.PI, angle);
            ctx.lineWidth = 14;
            ctx.strokeStyle = color;
            ctx.stroke();
        }

        function updateStatus(isConnected, text) {
            const el = document.getElementById('status');
            el.innerText = text;
            if (isConnected) {
                el.classList.add('connected');
            } else {
                el.classList.remove('connected');
            }
        }

        // ==========================================
        // 5. MODO SIMULAÇÃO (TESTE OFFLINE)
        // ==========================================
        function toggleSimulation() {
            isSimulating = !isSimulating;
            const btn = document.getElementById('btnSim');

            if (isSimulating) {
                btn.innerText = "Parar Simulação";
                btn.style.backgroundColor = "#e76f51";
                simInterval = setInterval(() => {
                    const mockData = {
                        rpm: Math.floor(800 + Math.random() * 5500),
                        map: Math.floor(30 + Math.random() * 120),
                        tps: Math.floor(Math.random() * 100),
                        clt: Math.floor(85 + Math.random() * 5),
                        afr: parseFloat((12.5 + Math.random() * 3).toFixed(1)),
                        bat: parseFloat((13.5 + Math.random() * 0.8).toFixed(1))
                    };
                    updateDashboard(mockData);
                }, 150);
            } else {
                btn.innerText = "Simular Dados";
                btn.style.backgroundColor = "#8257e5";
                clearInterval(simInterval);
            }
        }

        // Inicializa manômetros zerados
        drawGauge('gaugeRPM', 0, 0, 8000, '#04d361');
        drawGauge('gaugeMAP', 0, 0, 250, '#8257e5');
