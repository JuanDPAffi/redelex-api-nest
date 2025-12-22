
# 🏛️ Estados Procesales - Backend API

---

## 🛠 Requisitos Previos

* **Node.js:** v22.x (Requerido para compatibilidad con Azure App Service).
* **NPM:** Gestor de paquetes.
* **MongoDB:** URI de conexión válida (Atlas o Local).
* **Azure CLI:** (Opcional) Para gestión de despliegues manuales.

---

## 🚀 Instalación y Ejecución

1. **Clonar el repositorio:**
   **Bash**

   ```
   git clone https://github.com/JuanDPAffi/redelex-api-nest.git
   cd redelex-api-nest
   ```
2. **Instalar dependencias:**
   **Bash**

   ```
   npm install
   ```
3. **Ejecutar en modo desarrollo:**
   **Bash**

   ```
   npm run start:dev
   ```

   *La API estará disponible en: `http://localhost:4000/api`*
4. **Compilar para producción:**
   **Bash**

   ```
   npm run build
   npm run start:prod
   ```

---

## 🔑 Variables de Entorno

Crea un archivo `.env` en la raíz con las siguientes claves:

**Fragmento de código**

```
# --- APP CONFIG ---
PORT=4000
NODE_ENV=development
FRONT_BASE_URL=http://localhost:4200

# --- DATABASE ---
MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/db_name

# --- SEGURIDAD ---
JWT_SECRET=tu_secreto_jwt_seguro
SYSTEM_TASK_TOKEN=token_largo_para_tareas_automatizadas

# --- INTEGRACIÓN REDELEX ---
REDELEX_API_KEY=tu_api_key_redelex

# --- INTEGRACIÓN HUBSPOT ---
HUBSPOT_ACCESS_TOKEN=tu_private_app_token

# --- INTEGRACIÓN MICROSOFT GRAPH (CORREO) ---
TENANT_ID_AD=azure_tenant_id
CLIENT_ID_AD=azure_client_id
CLIENT_SECRET_AD=azure_client_secret
MAIL_DEFAULT_FROM=notificaciones@tu-dominio.com
MAIL_REMINDER_TO=destinatario_reportes@tu-dominio.com
```

---

## 🧩 Módulos del Sistema

### 1. Inmobiliaria (Gestión de Clientes)

* **Importación Masiva:** Procesa archivos Excel para altas/bajas masivas de clientes.
* **Sincronización de Estado:** Si una inmobiliaria se desactiva, bloquea automáticamente el acceso a todos sus usuarios asociados.

### 2. Redelex (Jurídica)

* **Consulta Inteligente:**
  * *Live:* Consulta en tiempo real para Inmobiliarias.
  * *Espejo:* Base de datos local para búsquedas rápidas por cédula (Affi).
* **Tenant Isolation:** Valida matemáticamente que un usuario externo solo vea procesos donde es parte procesal.

### 3. Support (HubSpot)

* Crea tickets de soporte y llamadas directamente en el CRM.
* Autocompleta datos de contacto y empresa consultando la API de HubSpot en tiempo real.

---

## ☁️ Despliegue (Azure & GitHub Actions)

El proyecto cuenta con CI/CD automatizado mediante  **GitHub Actions** .

### Workflow: `master_redelex.yml`

Se ejecuta automáticamente al hacer push a la rama `master`.

1. **Build:**
   * Instala dependencias.
   * Compila el proyecto (`npm run build`).
   * Ejecuta pruebas (si aplica).
2. **Deploy:**
   * Despliega el artefacto compilado a  **Azure App Service** .

### Configuración requerida en GitHub

Asegurar que el secreto `AZUREAPPSERVICE_PUBLISHPROFILE_...` esté configurado en los *Settings* del repositorio con el perfil de publicación XML descargado de Azure.

Desarrollado para Affi - Estados Procesales
