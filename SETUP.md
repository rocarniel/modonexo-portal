# MODO Nexo — Guia de Configuração

Siga esta ordem exata. Cada etapa gera uma informação que a próxima precisa.

---

## ETAPA 1 — Firebase (login e senhas)

1. Acesse **console.firebase.google.com**
2. Clique em **Adicionar projeto** → nome: `modonexo` → criar
3. No menu lateral, clique em **Authentication → Começar**
4. Ative o provedor **E-mail/senha**
5. Vá em **Configurações do projeto** (ícone de engrenagem, canto superior esquerdo)
6. Role até **Seus apps** → clique em **</>** (Web)
7. Nome do app: `modonexo-portal` → registrar
8. Copie os valores do bloco `firebaseConfig`:

```
apiKey:     COLE_AQUI
authDomain: COLE_AQUI
projectId:  COLE_AQUI
```

9. Abra o arquivo `js/config.js` e substitua os três valores `COLE_AQUI_FIREBASE_*`

### Criar usuários manualmente no Firebase

No Firebase Console → Authentication → Usuários → **Adicionar usuário**:

| E-mail | Senha provisória |
|--------|-----------------|
| rocarniel@gmail.com | (defina uma senha forte) |
| olegarioadvogado@gmail.com | (defina uma senha forte) |

> Os parceiros recebem acesso automaticamente via Make.com quando o status muda para "Ativo".

---

## ETAPA 2 — Cloudinary (armazenamento de imagens e PDFs)

1. Crie conta gratuita em **cloudinary.com** (25 GB grátis)
2. No painel, copie o **Cloud Name** (canto superior esquerdo)
3. Vá em **Settings → Upload → Upload presets**
4. Clique em **Add upload preset**
   - Signing mode: **Unsigned**
   - Folder: `modo`
5. Salve e copie o nome do preset

6. Abra `js/config.js` e substitua:
   - `COLE_AQUI_CLOUDINARY_CLOUD_NAME` → Cloud Name
   - `COLE_AQUI_CLOUDINARY_UPLOAD_PRESET` → nome do preset

---

## ETAPA 3 — Cloudflare Worker (backend seguro)

### 3a. Criar conta Cloudflare
1. Acesse **cloudflare.com** → criar conta gratuita
2. No painel, vá em **Workers & Pages → Create → Create Worker**
3. Nome: `modonexo-worker`
4. Clique em **Deploy** (com o código padrão — vamos substituir)

### 3b. Instalar Wrangler (ferramenta de deploy)
No Terminal do seu Mac:
```bash
npm install -g wrangler
wrangler login
```

### 3c. Configurar as chaves secretas
No Terminal, dentro da pasta `MODOnexo/worker/`:
```bash
cd /Users/ronaldo/Desktop/PARTIC/MODOnexo/worker

# Chave do Airtable (encontre em airtable.com → Account → API)
wrangler secret put AIRTABLE_API_KEY

# Chave do Firebase Web (a mesma "apiKey" do passo 1)
wrangler secret put FIREBASE_API_KEY
```
> O terminal vai pedir que você cole o valor de cada chave.

### 3d. Publicar o Worker
```bash
wrangler deploy
```

Ao final, você verá a URL do worker. Exemplo:
`https://modonexo-worker.SEU_USUARIO.workers.dev`

5. Abra `js/config.js` e substitua `COLE_AQUI_WORKER_URL` pela URL acima

---

## ETAPA 4 — GitHub Pages (hospedar o portal)

1. Acesse **github.com** → criar conta (se não tiver)
2. Clique em **New repository**
   - Nome: `modonexo-portal`
   - Visibilidade: **Public**
3. Faça upload de **todos os arquivos** da pasta `MODOnexo/`
   (arraste para a interface web do GitHub ou use `git push`)
4. Vá em **Settings → Pages**
   - Source: **Deploy from a branch → main → / (root)**
5. Aguarde ~2 minutos

O portal ficará disponível em:
`https://SEU_USUARIO.github.io/modonexo-portal`

---

## ETAPA 5 — Domínio próprio (modonexo.com.br)

1. No GitHub Pages → Settings → Pages → **Custom domain**
2. Digite: `portal.modonexo.com.br`
3. No painel do seu registrador de domínio, adicione um registro DNS:
   - Tipo: **CNAME**
   - Nome: `portal`
   - Valor: `SEU_USUARIO.github.io`
4. Aguarde a propagação (até 24h, normalmente 1h)
5. Marque a opção **Enforce HTTPS** no GitHub Pages

---

## ETAPA 6 — Make.com (ajustar automações)

### Cenário 5423952 — O que mudar:

**Rota 1 — Notificação de nova oportunidade** (manter como está)
- Trigger: Airtable → Watch Records (tabela Oportunidades)
- Ação: Enviar e-mail para rocarniel@gmail.com e olegarioadvogado@gmail.com
- ✅ Não precisa mudar nada

**Rota 2 — Criação de usuário (Softr → Firebase)**
- Trigger: Airtable → Watch Records (tabela Parceiros, campo Status = "Ativo")
- **Substituir** a ação de "criar usuário Softr" por:
  - Módulo: **HTTP → Make a request**
  - URL: `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=SUA_FIREBASE_API_KEY`
  - Método: POST
  - Body (JSON):
    ```json
    {
      "email": "{{e-mail do parceiro}}",
      "password": "{{gerar senha aleatória ou padrão}}",
      "displayName": "{{nome do parceiro}}"
    }
    ```
  - Após criar: enviar e-mail para o parceiro com link de redefinição de senha
    - URL do e-mail: `https://portal.modonexo.com.br/index.html` (com instrução de usar "Esqueci minha senha")

---

## ETAPA 7 — Google Drive (pasta de arquivos KMZ/KML)

1. Acesse **drive.google.com** com a conta `modogestaonexo@gmail.com`
2. Crie uma pasta chamada `MODOnexo — KMZ/KML`
3. Compartilhe com link público (qualquer pessoa com o link pode visualizar)
4. Oriente os parceiros: ao fazer upload de KMZ/KML nesta pasta, clicar com botão direito → **Obter link** → e colar no campo do formulário

> Imagens e PDFs vão direto para o Cloudinary automaticamente. Apenas KMZ/KML usam o Drive.

---

## Checklist final

| Item | Status |
|------|--------|
| Firebase criado e chaves no config.js | ☐ |
| Usuários admin criados no Firebase | ☐ |
| Cloudinary criado e chaves no config.js | ☐ |
| Worker publicado e URL no config.js | ☐ |
| Arquivos no GitHub Pages | ☐ |
| Domínio portal.modonexo.com.br apontando | ☐ |
| Make.com rota 2 atualizada | ☐ |
| Pasta Drive KMZ/KML criada | ☐ |
| Teste completo: login → cadastrar oportunidade → ver no mapa | ☐ |

---

## URLs finais do portal

| URL | Para quem |
|-----|-----------|
| `portal.modonexo.com.br` | Login (todos) |
| `portal.modonexo.com.br/cadastro.html` | Auto-cadastro de novos parceiros |
| `portal.modonexo.com.br/parceiro/dashboard.html` | Área do parceiro |
| `portal.modonexo.com.br/admin/mapa.html` | Área admin — mapa |
| `portal.modonexo.com.br/compartilhar/?token=XXX` | Link público de oportunidade |
