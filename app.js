import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { auth, db } from "./firebaseConfig.js";

// --- ESTADO MAESTRO ---
let budgets = [], transactions = [], wealth = [], creditCards = [], ccTransactions = [], customCategories = [];
let activeFormType = null, editingId = null, currentUser = null;
let currentMonth = new Date().toISOString().slice(0, 7); 
let systemTRM = 3900.00; 
let myChart = null;

const chartColors = ['#f43f5e', '#3b82f6', '#eab308', '#10b981', '#a855f7', '#06b6d4', '#f97316'];

// --- SOLUCIÓN 1: RECUPERAR TUS CATEGORÍAS CLÁSICAS ---
const CATEGORIES = {
    budget: ["Alimentación", "Transporte", "Servicios", "Entretenimiento", "Salud", "Otras categorías"],
    transaction: {
        "Salario": "income", "Ventas": "income", "Regalos": "income", "Rendimientos": "income",
        "Alimentación": "expense", "Transporte": "expense", "Servicios": "expense", "Entretenimiento": "expense", "Salud": "expense", "Compras": "expense", "Otras categorías": "expense",
        "Emergencia": "expense", "Pago Tarjeta": "expense"
    },
    wealthIcons: [
        { name: "Fondo de Emergencia", icon: "shield" }, { name: "CDT", icon: "lock" }, { name: "Ahorro Programado", icon: "piggy-bank" },
        { name: "Finca Raíz", icon: "home" }, { name: "Acciones / Inversión", icon: "trending-up" }, { name: "Otro Activo", icon: "briefcase" }
    ]
};

// Formateador de moneda (Máximo 2 decimales)
export function formatCurrency(value, currency = "COP") {
    const numericValue = Number(value) || 0;
    const decimalCount = (numericValue % 1 === 0) ? 0 : 2;
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency, minimumFractionDigits: decimalCount, maximumFractionDigits: 2 }).format(numericValue);
}

// --- SOLUCIÓN 2: TRM LIMPIA (Sin decimales raros) ---
async function sincronizarTRM() {
    document.getElementById("trm-display").textContent = "Sincronizando...";
    try {
        const respuesta = await fetch('https://open.er-api.com/v6/latest/USD');
        const datos = await respuesta.json();
        if (datos && datos.rates && datos.rates.COP) {
            systemTRM = parseFloat(datos.rates.COP);
        }
    } catch (error) {
        console.log("Usando TRM por defecto");
    }
    // Formato sin decimales para la TRM visual
    document.getElementById("trm-display").textContent = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(systemTRM);
    if (currentUser) actualizarDatosUI();
}

window.forzarActualizacionTRM = async () => await sincronizarTRM();
document.getElementById("full-date-display").textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
sincronizarTRM();

document.getElementById("month-selector").value = currentMonth;
document.getElementById("month-selector").addEventListener("change", (e) => { currentMonth = e.target.value; actualizarDatosUI(); });
document.getElementById("btnThemeToggle").addEventListener("click", () => document.body.classList.toggle("light-mode"));

// --- AUTH Y SESIÓN ---
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
    const nombre = document.getElementById("nombre").value.trim(), apellido = document.getElementById("apellido").value.trim();
    const email = document.getElementById("email").value.trim(), password = document.getElementById("password").value.trim();
    if (!nombre || !email || !password) return alert("Completa los campos obligatorios.");
    if (parseInt(document.getElementById("captcha-answer").value) !== captchaCorrectAnswer) return alert("Captcha incorrecto.");
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: `${nombre} ${apellido}` });
        await addDoc(collection(db, "creditCards"), { userId: cred.user.uid, limit: 3000000.00, createdAt: Date.now() });
    } catch (e) { alert("Error: " + e.message); }
});

document.getElementById("btnLogin").addEventListener("click", async () => {
    try { await signInWithEmailAndPassword(auth, document.getElementById("email").value, document.getElementById("password").value); } 
    catch (e) { alert("Credenciales incorrectas."); }
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

function cargarFlujosDeDatosFirebase() {
    const q = (col) => query(collection(db, col), where("userId", "==", currentUser.uid));
    onSnapshot(q("categories"), snap => { customCategories = snap.docs.map(d => ({ id: d.id, ...d.data() })); actualizarDatosUI(); });
    onSnapshot(q("transactions"), snap => { transactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("budgets"), snap => { budgets = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("wealth"), snap => { wealth = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("creditCards"), snap => { creditCards = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
    onSnapshot(q("ccTransactions"), snap => { ccTransactions = snap.docs.map(d => ({id: d.id, ...d.data()})); actualizarDatosUI(); });
}

window.showView = (vista) => {
    document.querySelectorAll('.view-container, .nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${vista}`).classList.add('active');
    const indiceMapeo = {'home': 0, 'budgets': 1, 'credit': 2, 'wealth': 3, 'categories': 4};
    if(indiceMapeo[vista] !== undefined && indiceMapeo[vista] < 4) document.querySelectorAll('.nav-item')[indiceMapeo[vista]].classList.add('active');
    actualizarDatosUI();
};

window.toggleBudgetDetails = (id) => {
    const divDetalle = document.getElementById(`budget-details-${id}`);
    if(divDetalle) divDetalle.style.display = (divDetalle.style.display === 'none' || divDetalle.style.display === '') ? 'flex' : 'none';
};

// --- RENDERIZADO CENTRAL ---
function actualizarDatosUI() {
    if (!currentUser) return;
    const resolverMontoCOP = (item) => item.baseCurrency === "USD" ? (item.amount * systemTRM) : (item.convertedAmount || item.amount);

    const transaccionesDelMes = transactions.filter(t => t.month === currentMonth);
    let ingresosTotalesCOP = transaccionesDelMes.filter(t => t.type === 'income').reduce((s, t) => s + resolverMontoCOP(t), 0);
    const egresosTotalesCOP = transaccionesDelMes.filter(t => t.type === 'expense').reduce((s, t) => s + resolverMontoCOP(t), 0);
    
    const transaccionesPasadas = transactions.filter(t => t.month < currentMonth);
    const remanenteRollover = transaccionesPasadas.filter(t => t.type === 'income').reduce((s, t) => s + resolverMontoCOP(t), 0) - transaccionesPasadas.filter(t => t.type === 'expense').reduce((s, t) => s + resolverMontoCOP(t), 0);
    
    if (remanenteRollover > 0) {
        ingresosTotalesCOP += remanenteRollover;
        document.getElementById("rollover-indicator").textContent = `Saldo (+${formatCurrency(remanenteRollover, "COP")} remanente)`;
    } else { document.getElementById("rollover-indicator").textContent = "Saldo Total Disponible"; }

    document.getElementById("total-income").textContent = `+${formatCurrency(ingresosTotalesCOP, "COP")}`;
    document.getElementById("total-expense").textContent = `-${formatCurrency(egresosTotalesCOP, "COP")}`;
    document.getElementById("total-balance").textContent = formatCurrency(ingresosTotalesCOP - egresosTotalesCOP, "COP");

    const contenedorTransacciones = document.getElementById("transaction-list");
    contenedorTransacciones.innerHTML = '';
    transaccionesDelMes.sort((a,b) => b.createdAt - a.createdAt).forEach(t => {
        let esIngreso = t.type === 'income';
        // SOLUCIÓN 3: onClick explícito blindado
        contenedorTransacciones.innerHTML += `
            <div class="item-card" onclick="window.openEditForm('transaction', '${t.id}')">
                <div class="item-left">
                    <div class="item-icon"><i data-lucide="${esIngreso ? 'arrow-down-left' : 'arrow-up-right'}"></i></div>
                    <div class="item-info"><h5>${t.category}</h5><p>${t.description || 'Sin detalle'}</p></div>
                </div>
                <div class="${esIngreso ? 'val-income' : 'val-expense'}">${esIngreso ? '+' : '-'}${formatCurrency(resolverMontoCOP(t), "COP")}</div>
            </div>`;
    });

    const contenedorPresupuestos = document.getElementById("budget-list");
    contenedorPresupuestos.innerHTML = budgets.length ? '' : `<p style="text-align:center; color:var(--text-muted); font-size:14px; margin-top:20px;">No tienes presupuestos activos.</p>`;
    budgets.forEach(b => {
        const acumuladoGastado = transaccionesDelMes.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + resolverMontoCOP(t), 0) + ccTransactions.filter(t => t.month === currentMonth && t.category === b.category).reduce((s, t) => s + resolverMontoCOP(t), 0);
        let pct = Math.min((acumuladoGastado / b.amount) * 100, 100);
        let color = pct >= 90 ? 'danger' : (pct >= 70 ? 'warning' : '');
        let importeRestante = b.amount - acumuladoGastado;

        contenedorPresupuestos.innerHTML += `
            <div class="item-card budget-card" onclick="window.toggleBudgetDetails('${b.id}')">
                <div class="budget-header">
                    <div class="item-left"><div class="item-icon"><i data-lucide="target"></i></div><div class="item-info"><h5 style="margin:0; font-size:16px;">${b.category}</h5></div></div>
                    <div style="text-align: right;">
                        <span style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;">Restante</span>
                        <span style="font-weight:700; font-size:16px; color: ${importeRestante < 0 ? 'var(--expense-color)' : 'var(--text-main)'};">${formatCurrency(importeRestante, "COP")}</span>
                    </div>
                </div>
                <div class="budget-progress-container"><div class="budget-progress-fill ${color}" style="width: ${pct}%;"></div></div>
                <div id="budget-details-${b.id}" class="budget-details">
                    <div class="budget-stats"><span>Consumido: <b>${formatCurrency(acumuladoGastado, "COP")}</b></span><span style="text-align:right;">Límite Total: <b>${formatCurrency(b.amount, "COP")}</b></span></div>
                    <button class="glass-btn secondary" style="padding:10px; font-size:14px; margin-top: 5px;" onclick="event.stopPropagation(); window.openEditForm('budget', '${b.id}')">Editar o Eliminar</button>
                </div>
            </div>`;
    });

    document.getElementById("total-wealth-value").textContent = formatCurrency(wealth.reduce((s, w) => s + resolverMontoCOP(w), 0), "COP");
    const contenedorBolsillos = document.getElementById("wealth-list");
    contenedorBolsillos.innerHTML = '';
    wealth.forEach(w => {
        contenedorBolsillos.innerHTML += `
            <div class="item-card" onclick="window.openEditForm('wealth', '${w.id}')">
                <div class="item-left"><div class="item-icon"><i data-lucide="${w.icon || 'briefcase'}"></i></div><div class="item-info"><h5>${w.name}</h5></div></div>
                <div style="font-weight:600;">${formatCurrency(resolverMontoCOP(w), "COP")}</div>
            </div>`;
    });

    if (creditCards.length > 0) {
        let metaTarjeta = creditCards[0];
        let deudaBrutaGenerada = ccTransactions.reduce((s, t) => s + (t.totalDebt || t.amount), 0);
        let abonosRealizados = transactions.filter(t => t.category === "Pago Tarjeta").reduce((s, t) => s + resolverMontoCOP(t), 0);
        let deudaVigenteEfectiva = Math.max(0, deudaBrutaGenerada - abonosRealizados);
        
        document.getElementById("cc-debt").textContent = formatCurrency(deudaVigenteEfectiva, "COP");
        document.getElementById("cc-available").textContent = formatCurrency(metaTarjeta.limit - deudaVigenteEfectiva, "COP");
        
        const contenedorTransaccionesTarjeta = document.getElementById("cc-transactions-list");
        contenedorTransaccionesTarjeta.innerHTML = ccTransactions.length ? '' : `<p style="text-align:center; color:var(--text-muted); font-size:12px; padding:10px;">Sin consumos.</p>`;
        
        ccTransactions.filter(t => t.month === currentMonth).forEach(t => {
            let trazaCuotas = t.cuotas > 1 ? `<span style="color:var(--expense-color); font-weight:bold;">(${t.cuotas}C - Total: ${formatCurrency(t.totalDebt, "COP")})</span>` : '';
            contenedorTransaccionesTarjeta.innerHTML += `
                <div class="item-card" onclick="window.openEditForm('cc-transaction', '${t.id}')">
                    <div class="item-left"><div class="item-icon"><i data-lucide="shopping-bag"></i></div><div class="item-info"><h5>${t.category}</h5><p>${t.description} ${trazaCuotas}</p></div></div>
                    <div class="val-expense">-${formatCurrency(resolverMontoCOP(t), "COP")}</div>
                </div>`;
        });
    }
    lucide.createIcons();
}

// --- SOLUCIÓN 4: BOTONES INGRESOS Y EGRESOS BLINDADOS ---
window.openFilteredTransactionsModal = (type) => {
    document.getElementById("modal-filtered-transactions").classList.add('active');
    document.getElementById("filtered-transactions-title").textContent = type === 'income' ? 'Total Ingresos' : 'Total Egresos';
    const currentMonthTrans = transactions.filter(t => t.month === currentMonth && t.type === type);
    const container = document.getElementById("filtered-transactions-list");
    container.innerHTML = currentMonthTrans.length ? '' : `<p style="text-align:center; color:var(--text-muted); font-size:14px; margin-top:20px;">No hay movimientos.</p>`;
    currentMonthTrans.sort((a,b)=>b.createdAt - a.createdAt).forEach(t => {
        let isInc = t.type === 'income';
        container.innerHTML += `<div class="item-card" onclick="window.openEditForm('transaction', '${t.id}')"><div class="item-left"><div class="item-icon"><i data-lucide="${isInc?'arrow-down-left':'arrow-up-right'}"></i></div><div class="item-info"><h5>${t.category}</h5><p>${t.description}</p></div></div><div class="${isInc?'val-income':'val-expense'}">${isInc?'+':'-'}${formatCurrency(t.amount, t.baseCurrency)}</div></div>`;
    });
    lucide.createIcons();
}
window.closeFilteredTransactionsModal = () => document.getElementById("modal-filtered-transactions").classList.remove('active');
document.getElementById("income-summary").addEventListener("click", () => window.openFilteredTransactionsModal('income'));
document.getElementById("expense-summary").addEventListener("click", () => window.openFilteredTransactionsModal('expense'));

// --- GENERADOR MEZCLADO DE CATEGORÍAS ---
function obtenerOpcionesCategoriasHTML(tipoFormulario) {
    let opciones = [];
    if (tipoFormulario === 'budget' || tipoFormulario === 'cc-transaction') opciones = [...CATEGORIES.budget];
    else opciones = Object.keys(CATEGORIES.transaction);
    
    // Sumar las nuevas sin borrar las tuyas
    customCategories.forEach(c => { if (!opciones.includes(c.name)) opciones.push(c.name); });
    return opciones.map(c => `<option value="${c}">${c}</option>`).join('');
}

// --- FORMULARIOS Y EDICIÓN ---
window.toggleForm = (tipoFormulario = null) => {
    activeFormType = tipoFormulario;
    editingId = null;
    document.getElementById("btnDeleteForm").style.display = 'none';
    if (!tipoFormulario) return document.getElementById("modal-form").classList.remove('active');
    
    document.getElementById("modal-form").classList.add('active');
    const contenedorCampos = document.getElementById("form-fields"), componenteTitulo = document.getElementById("form-title");
    
    if (tipoFormulario === 'transaction') {
        componenteTitulo.textContent = "Nuevo Movimiento";
        contenedorCampos.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${obtenerOpcionesCategoriasHTML('transaction')}</select><select id="f-currency" class="glass-input"><option value="COP" selected>Pesos (COP)</option><option value="USD">Dólares (USD)</option></select><input type="number" id="f-amount" class="glass-input" placeholder="Importe"><textarea id="f-desc" class="glass-input" placeholder="Descripción corta"></textarea>`;
    } else if (tipoFormulario === 'wealth') {
        componenteTitulo.textContent = "Añadir Activo";
        contenedorCampos.innerHTML = `<select id="f-type" class="glass-input">${CATEGORIES.wealthIcons.map(w => `<option value="${w.name}|${w.icon}">${w.name}</option>`).join('')}</select><select id="f-currency" class="glass-input"><option value="COP" selected>COP</option><option value="USD">USD</option></select><input type="text" id="f-desc" class="glass-input" placeholder="Nombre específico"><input type="number" id="f-amount" class="glass-input" placeholder="Saldo actual">`;
    } else if (tipoFormulario === 'budget') {
        componenteTitulo.textContent = "Presupuesto Mensual";
        contenedorCampos.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${obtenerOpcionesCategoriasHTML('budget')}</select><input type="number" id="f-amount" class="glass-input" placeholder="Límite Máximo ($ COP)">`;
    } else if (tipoFormulario === 'cc-transaction') {
        componenteTitulo.textContent = "Compra con Tarjeta";
        contenedorCampos.innerHTML = `<select id="f-cat" class="glass-input"><option value="" disabled selected>Categoría</option>${obtenerOpcionesCategoriasHTML('budget')}</select><select id="f-currency" class="glass-input"><option value="COP" selected>COP</option><option value="USD">USD</option></select><input type="number" id="f-amount" class="glass-input" placeholder="Monto"><input type="number" id="f-cuotas" class="glass-input" placeholder="Cuotas" value="1" min="1"><textarea id="f-desc" class="glass-input" placeholder="Detalle"></textarea>`;
    } else if (tipoFormulario === 'edit-cc-limit') {
        componenteTitulo.textContent = "Ajustar Cupo";
        let cupoActual = creditCards.length > 0 ? creditCards[0].limit : 3000000;
        contenedorCampos.innerHTML = `<input type="number" id="f-amount" class="glass-input" placeholder="Cupo Máximo" value="${cupoActual}">`;
    }
};

window.openEditForm = (type, id) => {
    window.toggleForm(type);
    editingId = id;
    document.getElementById("btnDeleteForm").style.display = 'block';
    
    let item;
    if (type === 'wealth') item = wealth.find(i => i.id === id);
    else if (type === 'transaction') item = transactions.find(i => i.id === id);
    else if (type === 'cc-transaction') item = ccTransactions.find(i => i.id === id);
    else if (type === 'budget') item = budgets.find(i => i.id === id);

    // Evitamos errores si el DOM no cargo un input
    if (item) {
        if (type === 'wealth') {
            const fType = document.getElementById("f-type"); if(fType) fType.value = `${item.name}|${item.icon}`;
            const fAmount = document.getElementById("f-amount"); if(fAmount) fAmount.value = item.amount;
            const fDesc = document.getElementById("f-desc"); if (fDesc) fDesc.value = item.description || "";
        } else {
            const fCat = document.getElementById("f-cat"); if (fCat) fCat.value = item.category;
            const fAmount = document.getElementById("f-amount"); if (fAmount) fAmount.value = item.amount;
            const fDesc = document.getElementById("f-desc"); if (fDesc) fDesc.value = item.description || "";
        }
    }
};

document.getElementById("btnSubmitForm").addEventListener("click", async () => {
    if (!activeFormType) return;
    const fAmount = document.getElementById("f-amount");
    if (fAmount && !fAmount.value) return alert("El monto es requerido.");

    const btn = document.getElementById("btnSubmitForm");
    btn.disabled = true;

    try {
        let payload = { userId: currentUser.uid, createdAt: Date.now() };
        let importeCapturado = fAmount ? parseFloat(fAmount.value) : 0;
        let divisaSeleccionada = document.getElementById("f-currency") ? document.getElementById("f-currency").value : "COP";

        payload.amount = importeCapturado;
        payload.baseCurrency = divisaSeleccionada;
        payload.exchangeRate = systemTRM;
        payload.convertedAmount = divisaSeleccionada === "USD" ? (importeCapturado * systemTRM) : importeCapturado;

        if (activeFormType === 'edit-cc-limit') {
            if (creditCards.length > 0) await updateDoc(doc(db, "creditCards", creditCards[0].id), { limit: importeCapturado });
            else await addDoc(collection(db, "creditCards"), { userId: currentUser.uid, limit: importeCapturado, createdAt: Date.now() });
        } else if (activeFormType === 'wealth') {
            const [name, icon] = document.getElementById("f-type").value.split('|');
            payload = { ...payload, name, icon, description: document.getElementById("f-desc").value };
            if(editingId) await updateDoc(doc(db, "wealth", editingId), payload); else await addDoc(collection(db, "wealth"), payload);
        } else if (activeFormType === 'transaction') {
            const cat = document.getElementById("f-cat").value;
            payload = { ...payload, category: cat, type: CATEGORIES.transaction[cat] || "expense", description: document.getElementById("f-desc").value, month: currentMonth };
            if (cat === "Emergencia") {
                let fondo = wealth.find(w => w.name === "Fondo de Emergencia");
                if (fondo) await updateDoc(doc(db, "wealth", fondo.id), { amount: Math.max(0, fondo.amount - (divisaSeleccionada === "USD" ? importeCapturado : (importeCapturado / systemTRM))) });
            }
            if(editingId) await updateDoc(doc(db, "transactions", editingId), payload); else await addDoc(collection(db, "transactions"), payload);
        } else if (activeFormType === 'cc-transaction') {
            const cuotas = parseInt(document.getElementById("f-cuotas").value) || 1;
            let deudaCalculadaProyectada = payload.convertedAmount;
            if (cuotas > 1) {
                const tasaMensual = Math.pow(1 + 0.2817, 1 / 12) - 1;
                deudaCalculadaProyectada = ((payload.convertedAmount * tasaMensual * Math.pow(1 + tasaMensual, cuotas)) / (Math.pow(1 + tasaMensual, cuotas) - 1)) * cuotas;
            }
            payload = { ...payload, category: document.getElementById("f-cat").value, cuotas: cuotas, totalDebt: deudaCalculadaProyectada, description: document.getElementById("f-desc").value, month: currentMonth };
            if(editingId) await updateDoc(doc(db, "ccTransactions", editingId), payload); else await addDoc(collection(db, "ccTransactions"), payload);
        } else if (activeFormType === 'budget') {
            const dataPresupuesto = { userId: currentUser.uid, category: document.getElementById("f-cat").value, amount: importeCapturado, createdAt: Date.now() };
            if(editingId) await updateDoc(doc(db, "budgets", editingId), dataPresupuesto); else await addDoc(collection(db, "budgets"), dataPresupuesto);
        }
        window.toggleForm();
    } catch (err) { alert("Error al guardar: " + err.message); } finally { btn.disabled = false; }
});

document.getElementById("btnDeleteForm").addEventListener("click", async () => {
    if (!editingId) return;
    let colName = activeFormType === 'transaction' ? 'transactions' : (activeFormType === 'budget' ? 'budgets' : (activeFormType === 'wealth' ? 'wealth' : 'ccTransactions'));
    try { await deleteDoc(doc(db, colName, editingId)); window.toggleForm(); window.closeFilteredTransactionsModal(); } catch (e) { alert("Error al eliminar"); }
});

window.openChartModal = () => {
    document.getElementById("modal-chart").classList.add('active');
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    let agrupacionEgresos = {}; let egresosTotales = 0;
    const resolverMontoCOP = (item) => item.baseCurrency === "USD" ? (item.amount * systemTRM) : (item.convertedAmount || item.amount);

    transactions.filter(t => t.type === 'expense' && t.month === currentMonth).forEach(t => { let cop = resolverMontoCOP(t); agrupacionEgresos[t.category] = (agrupacionEgresos[t.category] || 0) + cop; egresosTotales += cop; });
    ccTransactions.filter(t => t.month === currentMonth).forEach(t => { let cop = resolverMontoCOP(t); agrupacionEgresos[t.category] = (agrupacionEgresos[t.category] || 0) + cop; egresosTotales += cop; });

    document.getElementById("chart-total-expense").textContent = formatCurrency(egresosTotales, "COP");
    const contenedorLeyenda = document.getElementById("custom-legend");
    contenedorLeyenda.innerHTML = '';
    
    Object.keys(agrupacionEgresos).forEach((cat, idx) => {
        let porcentaje = egresosTotales > 0 ? Math.round((agrupacionEgresos[cat] / egresosTotales) * 100) : 0;
        contenedorLeyenda.innerHTML += `<div class="legend-item"><div style="display:flex; align-items:center; font-size:14px; font-weight:500;"><span class="legend-color-box" style="background:${chartColors[idx % chartColors.length]}"></span>${cat}</div><div><span style="font-weight:700;">${formatCurrency(agrupacionEgresos[cat], "COP")}</span><span style="font-size:12px; color:var(--text-muted); margin-left:6px;">${porcentaje}%</span></div></div>`;
    });

    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(agrupacionEgresos), datasets: [{ data: Object.values(agrupacionEgresos), backgroundColor: chartColors, borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue('--glass-bg').trim() }] }, options: { cutout: '78%', plugins: { legend: { display: false } } } });
};

window.closeChartModal = () => document.getElementById("modal-chart").classList.remove('active');
window.addEventListener('click', (e) => { if (e.target.classList.contains('modal-overlay')) { e.target.classList.remove('active'); window.closeChartModal(); } });