import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, where, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from "./firebaseConfig.js";

// --- ESTADO MAESTRO EXTENDIDO ---
let budgets = [], transactions = [], wealth = [], creditCards = [], ccTransactions = [], customCategories = [];
let activeFormType = null, editingId = null, currentUser = null;
let currentMonth = new Date().toISOString().slice(0, 7); 
let systemTRM = 4000.00; // Backup estático de contingencia
let trmSyncState = "Desconectado";
let selectedCategoryColor = "#ef4444";
let myChart = null;

const chartColors = ['#f43f5e', '#3b82f6', '#eab308', '#10b981', '#a855f7', '#06b6d4', '#f97316'];

// Categorías del Core (Semillas estáticas si no existen en BD)
const DEFAULT_CATEGORIES = [
    { name: "Alimentación", icon: "utensils", color: "#10b981" },
    { name: "Transporte", icon: "car", color: "#3b82f6" },
    { name: "Servicios", icon: "zap", color: "#eab308" },
    { name: "Entretenimiento", icon: "film", color: "#a855f7" },
    { name: "Salud", icon: "activity", color: "#f43f5e" },
    { name: "Otras categorías", icon: "folder", color: "#71717a" }
];

// --- REQUISITO CONTABLE 1: UTILIDAD DE FORMATEO CENTRALIZADA ---
/**
 * Formatea importes numéricos garantizando un techo estricto de 2 decimales adaptativos.
 * Reglas de negocio: 100 -> 100 | 100.1 -> 100.10 | 100.126 -> 100.13
 */
export function formatCurrency(value, currency = "COP") {
    const numericValue = Number(value) || 0;
    const decimalCount = (numericValue % 1 === 0) ? 0 : 2;
    
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: decimalCount,
        maximumFractionDigits: 2
    }).format(numericValue);
}

// --- REQUISITO CONTABLE 2: MOTOR DE SINCRONIZACIÓN DE TRM EN TIEMPO REAL ---
async function sincronizarTRM() {
    trmSyncState = "Sincronizando...";
    document.getElementById("trm-display").textContent = trmSyncState;
    try {
        const respuesta = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!respuesta.ok) throw new Error("Error en la respuesta de la API");
        const datos = await respuesta.json();
        if (datos && datos.rates && datos.rates.COP) {
            systemTRM = parseFloat(datos.rates.COP);
            trmSyncState = formatCurrency(systemTRM, "COP");
            localStorage.setItem("eva_cached_trm", systemTRM.toString());
            localStorage.setItem("eva_trm_updated_at", Date.now().toString());
            
            // Si la TRM cambia, recalculamos dinámicamente el portafolio/movimientos USD en memoria voluntaria
            if (currentUser) actualizarDatosUI();
        }
    } catch (error) {
        console.error("Falla en sincronización TRM en vivo, extrayendo caché:", error);
        const cached = localStorage.getItem("eva_cached_trm");
        if (cached) {
            systemTRM = parseFloat(cached);
            trmSyncState = `${formatCurrency(systemTRM, "COP")} (Caché)`;
        } else {
            trmSyncState = `${formatCurrency(systemTRM, "COP")} (Por Defecto)`;
        }
    }
    document.getElementById("trm-display").textContent = trmSyncState;
}

window.forzarActualizacionTRM = async () => {
    await sincronizarTRM();
};

// Inicialización de fecha y sincronización inicial de TRM al abrir la aplicación
document.getElementById("full-date-display").textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
sincronizarTRM();

// --- INICIALIZACIÓN DE COMPORTAMIENTO DE INTERFAZ ---
document.getElementById("month-selector").value = currentMonth;
document.getElementById("month-selector").addEventListener("change", (e) => {
    currentMonth = e.target.value;
    actualizarDatosUI();
});
document.getElementById("btnThemeToggle").addEventListener("click", () => document.body.classList.toggle("light-mode"));

// --- GESTIÓN DE SESIONES DE USUARIO (FIREBASE AUTH) ---
let captchaCorrectAnswer = 0;
document.getElementById("btnRegister").addEventListener("click", () => {
    document.getElementById("btnLogin").style.display = "none";
    document.getElementById("btnRegister").style.display = "none";
    document.getElementById("btnSubmitRegister").style.display = "block";
    document.getElementById("btnBackToLogin").style.display = "block";
    document.getElementById("register-fields").style.display = "block";
    document.getElementById("captcha-container").style.display = "block";
    
    let n1 = Math.floor(Math.random() * 9) + 1, n2 = Math.floor(Math.random() * 9) + 1;
    captchaCorrectAnswer = n1 + n2;
    document.getElementById("captcha-question").textContent = `${n1} + ${n2} =`;
});

document.getElementById("btnBackToLogin").addEventListener("click", () => window.location.reload());

document.getElementById("btnSubmitRegister").addEventListener("click", async () => {
    const nombre = document.getElementById("nombre").value.trim();
    const apellido = document.getElementById("apellido").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const captchaVal = parseInt(document.getElementById("captcha-answer").value);

    if (!nombre || !email || !password) return alert("Completa los campos obligatorios.");
    if (captchaVal !== captchaCorrectAnswer) return alert("Verificación anti-bot incorrecta.");

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: `${nombre} ${apellido}` });
        
        // Sembrar semilla de tarjeta de crédito por defecto
        await addDoc(collection(db, "creditCards"), { userId: cred.user.uid, limit: 3000000.00, createdAt: Date.now() });
        
        // Sembrar categorías core iniciales en su colección remota
        for (let cat of DEFAULT_CATEGORIES) {
            await addDoc(collection(db, "categories"), {
                userId: cred.user.uid,
                name: cat.name,
                icon: cat.icon,
                color: cat.color,
                isDefault: true,
                createdAt: Date.now()
            });
        }
    } catch (e) { alert("Error de registro: " + e.message); }
});

document.getElementById("btnLogin").addEventListener("click", async () => {
    const errorDisplay = document.getElementById("error-message");
    errorDisplay.style.display = "none";
    try { 
        await signInWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); 
    } catch (e) { 
        errorDisplay.textContent = "Credenciales incorrectas o falla de red.";
        errorDisplay.style.display = "block";
    }
});

document.getElementById("btnLogout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById("auth-panel").style.display = "none";
        document.getElementById("dashboard-panel").style.display = "block";
        document.getElementById("user-display").textContent = `EVA | Hola, ${user.displayName ? user.displayName.split(' ')[0] : 'Usuario'}`;
        cargarFlujosDeDatosFirebase();
        window.showView('home'); 
    } else {
        currentUser = null;
        document.getElementById("auth-panel").style.display = "block";
        document.getElementById("dashboard-panel").style.display = "none";
    }
});

// --- REQUISITO 3: CRUD COMPLETO Y ESCUCHA EN TIEMPO REAL DE CATEGORÍAS ---
function cargarFlujosDeDatosFirebase() {
    const obtenerQueryUsuario = (coleccion) => query(collection(db, coleccion), where("userId", "==", currentUser.uid));
    
    onSnapshot(obtenerQueryUsuario("categories"), snap => {
        customCategories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderizarVistaGestionCategorias();
        actualizarDatosUI(); 
    });
    onSnapshot(obtenerQueryUsuario("transactions"), snap => { transactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(obtenerQueryUsuario("budgets"), snap => { budgets = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(obtenerQueryUsuario("wealth"), snap => { wealth = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(obtenerQueryUsuario("creditCards"), snap => { creditCards = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(obtenerQueryUsuario("ccTransactions"), snap => { ccTransactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
}

window.showView = (vista) => {
    document.querySelectorAll('.view-container, .nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${vista}`).classList.add('active');
    
    const indiceMapeo = {'home': 0, 'budgets': 1, 'credit': 2, 'wealth': 3, 'categories': 4};
    if(indiceMapeo[vista] !== undefined && indiceMapeo[vista] < 4) {
        document.querySelectorAll('.nav-item')[indiceMapeo[vista]].classList.add('active');
    }
    actualizarDatosUI();
};

window.toggleBudgetDetails = (id) => {
    const divDetalle = document.getElementById(`budget-details-${id}`);
    divDetalle.style.display = (divDetalle.style.display === 'none' || divDetalle.style.display === '') ? 'flex' : 'none';
};

// --- RENDERIZADOR CONTABLE CENTRALIZADO ---
function actualizarDatosUI() {
    if (!currentUser) return;

    // Utilidad de mapeo para TRM dinámica o estática cruzada
    const resolverMontoCOP = (item) => {
        if (item.baseCurrency === "USD") {
            return item.amount * systemTRM; // Recalculado dinámicamente si fluctúa la TRM
        }
        return item.convertedAmount || item.amount; // Inmutable si se originó en COP
    };

    // 1. Procesamiento de Flujos del Tablero Principal (Filtrados por Mes)
    const transaccionesDelMes = transactions.filter(t => t.month === currentMonth);
    
    let ingresosTotalesCOP = transaccionesDelMes.filter(t => t.type === 'income').reduce((s, t) => s + resolverMontoCOP(t), 0);
    const egresosTotalesCOP = transaccionesDelMes.filter(t => t.type === 'expense').reduce((s, t) => s + resolverMontoCOP(t), 0);
    
    // 2. Cálculo del Remanente Técnico (Rollover)
    const transaccionesPasadas = transactions.filter(t => t.month < currentMonth);
    const ingresosPasados = transaccionesPasadas.filter(t => t.type === 'income').reduce((s, t) => s + resolverMontoCOP(t), 0);
    const egresosPasados = transaccionesPasadas.filter(t => t.type === 'expense').reduce((s, t) => s + resolverMontoCOP(t), 0);
    const remanenteRollover = ingresosPasados - egresosPasados;
    
    if (remanenteRollover > 0) {
        ingresosTotalesCOP += remanenteRollover;
        document.getElementById("rollover-indicator").textContent = `Saldo (+${formatCurrency(remanenteRollover, "COP")} de remanente)`;
    } else {
        document.getElementById("rollover-indicator").textContent = "Saldo Total Disponible";
    }

    // Inyección visual formateada con un límite estricto de dos decimales
    document.getElementById("total-income").textContent = `+${formatCurrency(ingresosTotalesCOP, "COP")}`;
    document.getElementById("total-expense").textContent = `-${formatCurrency(egresosTotalesCOP, "COP")}`;
    document.getElementById("total-balance").textContent = formatCurrency(ingresosTotalesCOP - egresosTotalesCOP, "COP");

    // Renderizado de lista de movimientos del mes
    const contenedorTransacciones = document.getElementById("transaction-list");
    contenedorTransacciones.innerHTML = '';
    transaccionesDelMes.sort((a,b) => b.createdAt - a.createdAt).forEach(t => {
        let esIngreso = t.type === 'income';
        contenedorTransacciones.innerHTML += `
            <div class="item-card" onclick="openEditForm('transaction', '${t.id}')">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${esIngreso ? 'arrow-down-left' : 'arrow-up-right'}"></i></div>
                    <div class="item-info">
                        <h5>${t.category}</h5>
                        <p>${t.description || 'Sin detalle'}</p>
                    </div>
                </div>
                <div class="${esIngreso ? 'val-income' : 'val-expense'}">
                    ${esIngreso ? '+' : '-'}${formatCurrency(resolverMontoCOP(t), "COP")}
                </div>
            </div>`;
    });

    // 3. Renderizado de Presupuestos Acoplados con Categorías Dinámicas e Integración de Tarjetas
    const contenedorPresupuestos = document.getElementById("budget-list");
    contenedorPresupuestos.innerHTML = budgets.length ? '' : `<p style="text-align:center; color:var(--text-muted); font-size:14px; margin-top:20px;">No tienes presupuestos activos.</p>`;
    
    budgets.forEach(b => {
        // --- REQUISITO CONTABLE 4: INTEGRACIÓN DE TARJETA DE CRÉDITO SIN DUPLICAR GASTOS ---
        // Sumamos los gastos normales en efectivo de esta categoría
        const gastosEfectivo = transaccionesDelMes.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + resolverMontoCOP(t), 0);
        
        // Sumamos los consumos a crédito realizados con la tarjeta que apunten a esta misma categoría
        const gastosTarjetaCredito = ccTransactions.filter(t => t.month === currentMonth && t.category === b.category).reduce((s, t) => s + resolverMontoCOP(t), 0);
        
        const acumuladoGastado = gastosEfectivo + gastosTarjetaCredito;
        let porcentajeConsumido = Math.min((acumuladoGastado / b.amount) * 100, 100);
        let claseAlertaColor = porcentajeConsumido >= 90 ? 'danger' : (porcentajeConsumido >= 70 ? 'warning' : '');
        let importeRestante = b.amount - acumuladoGastado;

        contenedorPresupuestos.innerHTML += `
            <div class="item-card budget-card" onclick="toggleBudgetDetails('${b.id}')">
                <div class="budget-header">
                    <div class="item-left">
                        <div class="item-icon"><i data-lucide="target"></i></div>
                        <div class="item-info"><h5 style="margin:0; font-size:16px;">${b.category}</h5></div>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;">Restante</span>
                        <span style="font-weight:700; font-size:16px; color: ${importeRestante < 0 ? 'var(--expense-color)' : 'var(--text-main)'};">${formatCurrency(importeRestante, "COP")}</span>
                    </div>
                </div>
                <div class="budget-progress-container">
                    <div class="budget-progress-fill ${claseAlertaColor}" style="width: ${porcentajeConsumido}%;"></div>
                </div>
                <div id="budget-details-${b.id}" class="budget-details">
                    <div class="budget-stats">
                        <span>Consumido Total: <b>${formatCurrency(acumuladoGastado, "COP")}</b></span>
                        <span style="text-align:right;">Límite Fijo: <b>${formatCurrency(b.amount, "COP")}</b></span>
                    </div>
                    <p style="font-size:11px; color:var(--text-muted); margin:0;">(Efectivo: ${formatCurrency(gastosEfectivo, "COP")} | Crédito: ${formatCurrency(gastosTarjetaCredito, "COP")})</p>
                    <button class="glass-btn secondary" style="padding:10px; font-size:14px; margin-top: 5px;" onclick="event.stopPropagation(); openEditForm('budget', '${b.id}')">Modificar Parámetros</button>
                </div>
            </div>`;
    });

    // 4. Renderizado de Portafolio / Patrimonio Líquido
    document.getElementById("total-wealth-value").textContent = formatCurrency(wealth.reduce((s, w) => s + resolverMontoCOP(w), 0), "COP");
    const contenedorBolsillos = document.getElementById("wealth-list");
    contenedorBolsillos.innerHTML = '';
    wealth.forEach(w => {
        contenedorBolsillos.innerHTML += `
            <div class="item-card" onclick="openEditForm('wealth', '${w.id}')">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${w.icon || 'briefcase'}"></i></div>
                    <div class="item-info">
                        <h5>${w.name}</h5>
                        <p>${w.baseCurrency === 'USD' ? `Original: $${w.amount.toFixed(2)} USD` : 'Bolsillo Líquido'}</p>
                    </div>
                </div>
                <div style="font-weight:600;">${formatCurrency(resolverMontoCOP(w), "COP")}</div>
            </div>`;
    });

    // 5. Motor de Amortización de Tarjeta de Crédito (Cálculo de Deuda y Cupo)
    if (creditCards.length > 0) {
        let metaTarjeta = creditCards[0];
        
        // Consumos históricos totales realizados con plástico (con intereses integrados)
        let deudaBrutaGenerada = ccTransactions.reduce((s, t) => s + (t.totalDebt || t.amount), 0);
        
        // Pagos/Abonos históricos del tablero bajo la categoría de partida doble "Pago Tarjeta"
        let abonosRealizados = transactions.filter(t => t.category === "Pago Tarjeta").reduce((s, t) => s + resolverMontoCOP(t), 0);
        
        let deudaVigenteEfectiva = Math.max(0, deudaBrutaGenerada - abonosRealizados);
        
        document.getElementById("cc-debt").textContent = formatCurrency(deudaVigenteEfectiva, "COP");
        document.getElementById("cc-available").textContent = formatCurrency(metaTarjeta.limit - deudaVigenteEfectiva, "COP");
        
        const contenedorTransaccionesTarjeta = document.getElementById("cc-transactions-list");
        contenedorTransaccionesTarjeta.innerHTML = ccTransactions.length ? '' : `<p style="text-align:center; color:var(--text-muted); font-size:12px; padding:10px;">Sin consumos con tarjeta este mes.</p>`;
        
        ccTransactions.filter(t => t.month === currentMonth).forEach(t => {
            let trazaCuotas = t.cuotas > 1 ? `<span style="color:var(--expense-color); font-weight:bold;">(${t.cuotas}C - Total diferido con interés: ${formatCurrency(t.totalDebt, "COP")})</span>` : '<span style="color:var(--income-color); font-weight:500;">(1 Cuota - 0% Int)</span>';
            contenedorTransaccionesTarjeta.innerHTML += `
                <div class="item-card" onclick="openEditForm('cc-transaction', '${t.id}')">
                    <div class="item-left">
                        <div class="item-icon"><i data-lucide="shopping-bag"></i></div>
                        <div class="item-info">
                            <h5>${t.category}</h5>
                            <p>${t.description || 'Compra'} ${trazaCuotas}</p>
                        </div>
                    </div>
                    <div class="val-expense">-${formatCurrency(resolverMontoCOP(t), "COP")}</div>
                </div>`;
        });
    }

    lucide.createIcons();
}

// --- RENDERING AUXILIAR DE CRUD DE CATEGORÍAS ---
function renderizarVistaGestionCategorias() {
    const contenedor = document.getElementById("custom-categories-management-list");
    if (!contenedor) return;
    contenedor.innerHTML = '';
    
    customCategories.forEach(c => {
        contenedor.innerHTML += `
            <div class="item-card" style="border-left: 4px solid ${c.color || '#fff'}">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${c.icon || 'tag'}"></i></div>
                    <div class="item-info">
                        <h5>${c.name}</h5>
                        <p>${c.isDefault ? 'Sistema (Fijo)' : 'Personalizada (Editable)'}</p>
                    </div>
                </div>
                <div>
                    ${c.isDefault ? '' : `<button onclick="eliminarCategoriaExclusiva('${c.id}')" class="icon-btn" style="color:var(--expense-color); border:none;"><i data-lucide="trash-2" style="width:16px;"></i></button>`}
                </div>
            </div>`;
    });
    lucide.createIcons();
}

async function eliminarCategoriaExclusiva(id) {
    if(confirm("¿Estás seguro de eliminar esta categoría? Los presupuestos asociados perderán su segmento.")) {
        try { await deleteDoc(doc(db, "categories", id)); } catch(e) { alert("Error al remover categoría"); }
    }
}

// --- GENERADOR DINÁMICO DE OPCIONES EN SELECTORES ---
function obtenerOpcionesCategoriasHTML() {
    // Une categorías nativas y personalizadas del usuario unificadamente en la UI
    return customCategories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
}

// --- CONSTRUCTOR DE SELECTOR DE COLOR PARA CATEGORÍAS ---
function renderizarColorPicker() {
    const colores = ['#f43f5e', '#3b82f6', '#eab308', '#10b981', '#a855f7', '#06b6d4', '#f97316'];
    return `
        <div class="color-picker-group">
            ${colores.map(col => `
                <div class="color-dot" style="background:${col}" onclick="window.setCategoryColor(this, '${col}')"></div>
            `).join('')}
        </div>
    `;
}
window.setCategoryColor = (elemento, color) => {
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
    elemento.classList.add('selected');
    selectedCategoryColor = color;
};

// --- CONTROLADOR DE FORMULARIOS MODULARES (MUESTRA CAMPOS SEGÚN CONTEXTO) ---
window.toggleForm = (tipoFormulario = null) => {
    activeFormType = tipoFormulario;
    editingId = null;
    document.getElementById("btnDeleteForm").style.display = 'none';

    if (!tipoFormulario) return document.getElementById("modal-form").classList.remove('active');
    
    document.getElementById("modal-form").classList.add('active');
    const contenedorCampos = document.getElementById("form-fields");
    const componenteTitulo = document.getElementById("form-title");
    
    if (tipoFormulario === 'transaction') {
        componenteTitulo.textContent = "Nuevo Movimiento";
        contenedorCampos.innerHTML = `
            <select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${obtenerOpcionesCategoriasHTML()}</select>
            <select id="f-currency" class="glass-input"><option value="COP" selected>Pesos Colombianos (COP)</option><option value="USD">Dólares (USD)</option></select>
            <input type="number" id="f-amount" class="glass-input" placeholder="Importe / Valor">
            <textarea id="f-desc" class="glass-input" placeholder="Descripción corta"></textarea>
        `;
    } else if (tipoFormulario === 'wealth') {
        componenteTitulo.textContent = "Añadir Activo";
        contenedorCampos.innerHTML = `
            <select id="f-type" class="glass-input">
                ${CATEGORIES.wealthIcons.map(w => `<option value="${w.name}|${w.icon}">${w.name}</option>`).join('')}
            </select>
            <select id="f-currency" class="glass-input"><option value="COP" selected>COP</option><option value="USD">USD</option></select>
            <input type="text" id="f-desc" class="glass-input" placeholder="Nombre específico">
            <input type="number" id="f-amount" class="glass-input" placeholder="Saldo actual">
        `;
    } else if (tipoFormulario === 'budget') {
        componenteTitulo.textContent = "Asignar Presupuesto Mensual";
        contenedorCampos.innerHTML = `
            <select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría a limitar</option>${obtenerOpcionesCategoriasHTML()}</select>
            <input type="number" id="f-amount" class="glass-input" placeholder="Límite Mensual Máximo ($ COP)">
        `;
    } else if (tipoFormulario === 'cc-transaction') {
        componenteTitulo.textContent = "Compra con Tarjeta (Crédito)";
        componenteTitulo.style.color = "#ffffff";
        fields.innerHTML = `
            <select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría de Gasto</option>${obtenerOpcionesCategoriasHTML()}</select>
            <select id="f-currency" class="glass-input"><option value="COP" selected>COP</option><option value="USD">USD</option></select>
            <input type="number" id="f-amount" class="glass-input" placeholder="Monto Neto de Compra">
            <input type="number" id="f-cuotas" class="glass-input" placeholder="Diferir a cuántas cuotas" value="1" min="1">
            <textarea id="f-desc" class="glass-input" placeholder="Comercio / Detalle"></textarea>
        `;
    } else if (tipoFormulario === 'edit-cc-limit') {
        componenteTitulo.textContent = "Parametrizar Cupo Plástico";
        let cupoActual = creditCards.length > 0 ? creditCards[0].limit : 3000000;
        contenedorCampos.innerHTML = `<input type="number" id="f-amount" class="glass-input" placeholder="Cupo Máximo Asignado ($ COP)" value="${cupoActual}">`;
    } else if (tipoFormulario === 'custom-category') {
        componenteTitulo.textContent = "Crear Categoría Exclusiva";
        contenedorCampos.innerHTML = `
            <input type="text" id="f-cat-name" class="glass-input" placeholder="Nombre de categoría (ej: Mascotas)">
            <select id="f-cat-icon" class="glass-input">
                <option value="tag">Etiqueta</option><option value="dog">Mascota</option><option value="plane">Viajes</option>
                <option value="trending-up">Inversión</option><option value="tv">Streaming</option><option value="shield-alert">Emergencia</option>
            </select>
            <p style="margin-top:15px; font-size:13px; color:var(--text-muted);">Selecciona un color distintivo:</p>
            ${renderizarColorPicker()}
        `;
    }
};

// --- ORQUESTADOR CENTRAL DE ACCIONES DE PERSISTENCIA (GUARDAR) ---
document.getElementById("btnSubmitForm").addEventListener("click", async () => {
    if (!activeFormType) return;
    
    // Tratamiento atómico del Formulario de Categorías antes del mapeo común
    if(activeFormType === 'custom-category') {
        const nombreCat = document.getElementById("f-cat-name").value.trim();
        const iconoCat = document.getElementById("f-cat-icon").value;
        if(!nombreCat) return alert("Especifica un nombre.");
        
        // Validación estricta anti-duplicados
        if(customCategories.some(c => c.name.toLowerCase() === nombreCat.toLowerCase())) {
            return alert("Esta categoría ya se encuentra registrada.");
        }
        
        await addDoc(collection(db, "categories"), {
            userId: currentUser.uid,
            name: nombreCat,
            icon: iconoCat,
            color: selectedCategoryColor,
            isDefault: false,
            createdAt: Date.now()
        });
        window.toggleForm();
        return;
    }

    const fAmount = document.getElementById("f-amount");
    if (fAmount && !fAmount.value) return alert("El monto es requerido.");

    const btn = document.getElementById("btnSubmitForm");
    btn.disabled = true;

    try {
        let payload = { userId: currentUser.uid, createdAt: Date.now() };
        let importeCapturado = fAmount ? parseFloat(fAmount.value) : 0;
        let divisaSeleccionada = document.getElementById("f-currency") ? document.getElementById("f-currency").value : "COP";

        // Estructura de guardado para la TRM
        payload.amount = importeCapturado;
        payload.baseCurrency = divisaSeleccionada;
        payload.exchangeRate = systemTRM;
        payload.lastUpdatedAt = Date.now();
        payload.convertedAmount = divisaSeleccionada === "USD" ? (importeCapturado * systemTRM) : importeCapturado;

        if (activeFormType === 'edit-cc-limit') {
            if (creditCards.length > 0) {
                await updateDoc(doc(db, "creditCards", creditCards[0].id), { limit: importeCapturado });
            } else {
                await addDoc(collection(db, "creditCards"), { userId: currentUser.uid, limit: importeCapturado, createdAt: Date.now() });
            }
        } else if (activeFormType === 'wealth') {
            const [name, icon] = document.getElementById("f-type").value.split('|');
            payload = { ...payload, name, icon, description: document.getElementById("f-desc").value };
            await addDoc(collection(db, "wealth"), payload);
        } else if (activeFormType === 'transaction') {
            const cat = document.getElementById("f-cat").value;
            payload = { ...payload, category: cat, type: CATEGORIES.transaction[cat], description: document.getElementById("f-desc").value, month: currentMonth };
            
            // Mitigación contable del impacto directo en fondos si es de Emergencia
            if (cat === "Emergencia") {
                let bolsilloFondo = wealth.find(w => w.name === "Fondo de Emergencia");
                if (bolsilloFondo) {
                    let nuevoSaldo = bolsilloFondo.amount - (divisaSeleccionada === "USD" ? importeCapturado : (importeCapturado / systemTRM));
                    await updateDoc(doc(db, "wealth", bolsilloFondo.id), { amount: Math.max(0, nuevoSaldo) });
                }
            }
            await addDoc(collection(db, "transactions"), payload);
        } else if (activeFormType === 'cc-transaction') {
            const cuotas = parseInt(document.getElementById("f-cuotas").value) || 1;
            let deudaCalculadaProyectada = payload.convertedAmount;

            // Sistema de amortización real si se difiere a más de 1 cuota (28.17% EA)
            if (cuotas > 1) {
                const EA = 0.2817;
                const tasaMensualEquivalente = Math.pow(1 + EA, 1 / 12) - 1;
                const cuotaMensualFija = (payload.convertedAmount * tasaMensualEquivalente * Math.pow(1 + tasaMensualEquivalente, cuotas)) / (Math.pow(1 + tasaMensualEquivalente, cuotas) - 1);
                deudaCalculadaProyectada = cuotaMensualFija * cuotas;
            }

            payload = { 
                ...payload, 
                category: document.getElementById("f-cat").value, 
                cuotas: cuotas, 
                totalDebt: deudaCalculadaProyectada, 
                description: document.getElementById("f-desc").value, 
                month: currentMonth 
            };
            await addDoc(collection(db, "ccTransactions"), payload);
        } else if (activeFormType === 'budget') {
            const dataPresupuesto = {
                userId: currentUser.uid,
                category: document.getElementById("f-cat").value,
                amount: importeCapturado,
                createdAt: Date.now()
            };
            await addDoc(collection(db, "budgets"), dataPresupuesto);
        }
        
        window.toggleForm();
    } catch (err) {
        alert("Falla de escritura en la base de datos remota: " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Guardar";
    }
});

// --- ELIMINAR TRANSACCIONES ---
document.getElementById("btnDeleteForm").addEventListener("click", async () => {
    if (!editingId) return;
    let col = activeFormType === 'transaction' ? 'transactions' : (activeFormType === 'budget' ? 'budgets' : (activeFormType === 'wealth' ? 'wealth' : 'ccTransactions'));
    try { 
        await deleteDoc(doc(db, col, editingId)); 
        window.toggleForm(); 
    } catch (e) { alert("Falla al remover el registro."); }
});

// --- MOTOR GRÁFICO PROFESIONAL (CHART.JS INTEGRADO A CATEGORÍAS) ---
window.openChartModal = () => {
    document.getElementById("modal-chart").classList.add('active');
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    
    let agrupacionEgresos = {};
    let egresosTotalesProcesados = 0;

    const resolverMontoCOP = (item) => item.baseCurrency === "USD" ? (item.amount * systemTRM) : (item.convertedAmount || item.amount);

    // Unificamos gastos en efectivo y consumos a crédito del mes bajo análisis
    transactions.filter(t => t.type === 'expense' && t.month === currentMonth).forEach(t => {
        let cop = resolverMontoCOP(t);
        agrupacionEgresos[t.category] = (agrupacionEgresos[t.category] || 0) + cop;
        egresosTotalesProcesados += cop;
    });

    ccTransactions.filter(t => t.month === currentMonth).forEach(t => {
        let cop = resolverMontoCOP(t);
        agrupacionEgresos[t.category] = (agrupacionEgresos[t.category] || 0) + cop;
        egresosTotalesProcesados += cop;
    });

    document.getElementById("chart-total-expense").textContent = formatCurrency(egresosTotalesProcesados, "COP");
    
    const contenedorLeyenda = document.getElementById("custom-legend");
    contenedorLeyenda.innerHTML = '';
    
    const arrayCategorias = Object.keys(agrupacionEgresos);
    const arrayValores = Object.values(agrupacionEgresos);

    arrayCategorias.forEach((cat, idx) => {
        let porcentaje = egresosTotalesProcesados > 0 ? Math.round((arrayValores[idx] / egresosTotalesProcesados) * 100) : 0;
        let colorAsignado = chartColors[idx % chartColors.length];
        
        contenedorLeyenda.innerHTML += `
            <div class="legend-item">
                <div style="display:flex; align-items:center; font-size:14px; font-weight:500;">
                    <span class="legend-color-box" style="background:${colorAsignado}"></span>${cat}
                </div>
                <div>
                    <span style="font-weight:700;">${formatCurrency(arrayValores[idx], "COP")}</span>
                    <span style="font-size:12px; color:var(--text-muted); margin-left:6px;">${porcentaje}%</span>
                </div>
            </div>`;
    });

    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: arrayCategorias,
            datasets: [{
                data: arrayValores,
                backgroundColor: chartColors,
                borderWidth: 2,
                borderColor: getComputedStyle(document.body).getPropertyValue('--glass-bg').trim(),
                borderRadius: 4
            }]
        },
        options: {
            cutout: '78%',
            plugins: { legend: { display: false } }
        }
    });
};

window.closeChartModal = () => document.getElementById("modal-chart").classList.remove('active');

// UX Premium: Cerrar modales tocando la capa oscura externa
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
        closeChartModal();
    }
});
// ... (arriba está todo el código del Paso 2)

// UX Premium: Cerrar modales tocando la capa oscura externa
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
        closeChartModal();
    }
});

// ---------------------------------------------------------
// AQUÍ PEGAS EL PASO 3
// ---------------------------------------------------------

/**
 * Suite de verificación para los Requisitos Core de EVA (Monetario y TRM)
 */
export function ejecutarSuiteDePruebasFinancieras() {
    console.log("=== INICIANDO VALIDACIÓN DE PRUEBAS UNITARIAS (EVA CONTABLE) ===");
    // ... (el resto del código del paso 3)
}