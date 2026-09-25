import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from './api';

const palette = { ink: '#17211b', muted: '#68756c', green: '#116149', lime: '#d8f36a', paper: '#f5f7f1', line: '#dce4da', white: '#fff', danger: '#b23a48' };

function Field({ label, ...props }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput placeholderTextColor="#96a098" style={styles.input} {...props} /></View>;
}

function Button({ title, onPress, secondary = false }) {
  return <Pressable onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary]}><Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{title}</Text></Pressable>;
}

function Page({ title, children, onBack }) {
  return <ScrollView contentContainerStyle={styles.page}><Pressable onPress={onBack}><Text style={styles.back}>‹ Voltar</Text></Pressable><Text style={styles.pageTitle}>{title}</Text>{children}</ScrollView>;
}

export function PublicScreen({ kind, onBack }) {
  const content = {
    sobre: ['Sobre o SOS-CAR', 'O SOS-CAR conecta quem precisa de socorro automotivo a prestadores disponíveis na região, de forma rápida e transparente.', 'O cliente descreve o problema e sua localização; os prestadores da categoria certa recebem o chamado, e o primeiro que aceitar assume o atendimento.'],
    termos: ['Termos de Uso', 'A plataforma conecta clientes e prestadores. O atendimento, preço, qualidade e prazo são combinados diretamente entre as partes.', 'É proibido cadastrar dados falsos, tentar burlar a regra de aceite ou usar o sistema para finalidade ilícita.'],
    privacidade: ['Política de Privacidade', 'Coletamos nome, email, CPF, telefone e localização apenas quando necessários para o funcionamento do serviço.', 'Senhas são armazenadas apenas como hash criptográfico. Dados de contato só aparecem entre cliente e prestador depois que o chamado é aceito.']
  }[kind];
  const faqs = [['Como peço socorro?', 'Entre como cliente, escolha a categoria, informe o endereço ou use o GPS e toque em Solicitar socorro.'], ['Posso cancelar?', 'Sim, enquanto ninguém aceitou ou até um minuto depois do aceite.'], ['Como funciona a avaliação?', 'Após a conclusão, o cliente dá uma nota de 1 a 5 e pode comentar.'], ['Como recebo chamados?', 'Entre como prestador, ative Disponível e permita o acesso à localização.']];
  if (kind === 'ajuda') return <Page title="Central de ajuda" onBack={onBack}>{faqs.map(([question, answer]) => <View key={question} style={styles.faq}><Text style={styles.faqQuestion}>{question}</Text><Text style={styles.body}>{answer}</Text></View>)}</Page>;
  return <Page title={content[0]} onBack={onBack}><Text style={styles.body}>{content[1]}</Text><Text style={styles.body}>{content[2]}</Text><Text style={styles.muted}>Última atualização: 2026.</Text></Page>;
}

export function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await api.forgotPassword({ email }); setSent(true); } catch (error) { Alert.alert('Não foi possível enviar', error.message); } finally { setBusy(false); } };
  return <Page title="Esqueceu sua senha?" onBack={onBack}><Text style={styles.body}>Informe seu email cadastrado para receber um link de redefinição.</Text>{sent ? <View style={styles.success}><Text style={styles.successText}>Se o email estiver cadastrado, o link foi enviado.</Text></View> : <><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" /><Button title={busy ? 'Enviando...' : 'Enviar link'} onPress={submit} /></>}</Page>;
}

export function ResetPassword({ token, type, onDone }) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); try { await api.resetPassword({ token, tipo: type, novaSenha: password }); Alert.alert('Senha redefinida', 'Você já pode entrar novamente.'); onDone(); } catch (error) { Alert.alert('Link inválido', error.message); } finally { setBusy(false); } };
  return <Page title="Criar nova senha" onBack={onDone}><Text style={styles.body}>Escolha uma nova senha para sua conta.</Text><Field label="Nova senha" value={password} onChangeText={setPassword} secureTextEntry /><Button title={busy ? 'Salvando...' : 'Redefinir senha'} onPress={submit} /></Page>;
}

export function AccountSettings({ user, categories, onSaved, onBack }) {
  const [form, setForm] = useState({ nome: user.nome || '', telefone: user.telefone || '', senha: '', categoriaId: String(user.categoriaId || '') }); const [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => { setBusy(true); try { const updated = await api.updateUser({ ...form, categoriaId: form.categoriaId ? Number(form.categoriaId) : undefined }); onSaved(updated); Alert.alert('Salvo', 'Dados atualizados com sucesso.'); } catch (error) { Alert.alert('Não foi possível salvar', error.message); } finally { setBusy(false); } };
  return <Page title="Configurações da conta" onBack={onBack}><Text style={styles.body}>Atualize seus dados pessoais. Deixe a senha em branco para mantê-la.</Text><Field label="Nome completo" value={form.nome} onChangeText={(value) => update('nome', value)} /><Field label="Telefone" value={form.telefone} onChangeText={(value) => update('telefone', value)} keyboardType="phone-pad" />{user.categoriaId && <><Text style={styles.label}>Categoria</Text><View style={styles.chips}>{categories.map((category) => <Pressable key={category.id} onPress={() => update('categoriaId', String(category.id))} style={[styles.chip, form.categoriaId === String(category.id) && styles.chipActive]}><Text style={form.categoriaId === String(category.id) ? styles.chipActiveText : styles.chipText}>{category.nome}</Text></Pressable>)}</View></>}<Field label="Nova senha (opcional)" value={form.senha} onChangeText={(value) => update('senha', value)} secureTextEntry /><Button title={busy ? 'Salvando...' : 'Salvar alterações'} onPress={submit} /></Page>;
}

export function HistoryScreen({ onBack }) {
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true);
  useEffect(() => { api.historico().then(setItems).catch((error) => Alert.alert('Histórico indisponível', error.message)).finally(() => setLoading(false)); }, []);
  return <Page title="Histórico de chamados" onBack={onBack}>{loading ? <Text style={styles.muted}>Carregando...</Text> : items.length === 0 ? <Text style={styles.muted}>Nenhum atendimento finalizado.</Text> : items.map((item) => <View key={item.id} style={styles.history}><Text style={styles.historyTitle}>{item.categoriaNome || 'Atendimento'}</Text><Text style={styles.body}>{item.endereco || 'Localização por GPS'}</Text><Text style={styles.muted}>{item.status} · {new Date(item.dataAbertura).toLocaleDateString('pt-BR')}</Text></View>)}</Page>;
}

export function AdminScreen({ onBack, onLogged, onLogout }) {
  const [logged, setLogged] = useState(false); const [form, setForm] = useState({ email: '', senha: '' }); const [stats, setStats] = useState(null); const [users, setUsers] = useState(null); const [calls, setCalls] = useState([]); const [categories, setCategories] = useState([]);
  const login = async () => { try { const response = await api.adminLogin(form); await api.setToken(response.token); setLogged(true); onLogged({ tipo: 'admin', usuario: response.usuario }); } catch (error) { Alert.alert('Acesso negado', error.message); } };
  const refresh = async () => { try { const [nextStats, nextUsers, nextCalls, nextCategories] = await Promise.all([api.adminStats(), api.adminUsers(), api.adminCalls(), api.adminCategories()]); setStats(nextStats); setUsers(nextUsers); setCalls(nextCalls); setCategories(nextCategories); } catch (error) { Alert.alert('Painel indisponível', error.message); } };
  useEffect(() => { if (logged) refresh(); }, [logged]);
  if (!logged) return <Page title="Acesso administrativo" onBack={onBack}><Field label="Email" value={form.email} onChangeText={(email) => setForm({ ...form, email })} keyboardType="email-address" autoCapitalize="none" /><Field label="Senha" value={form.senha} onChangeText={(senha) => setForm({ ...form, senha })} secureTextEntry /><Button title="Entrar" onPress={login} /></Page>;
  return <Page title="Painel administrativo" onBack={onLogout}><View style={styles.statRow}>{[['Clientes', stats?.totalClientes], ['Prestadores', stats?.totalPrestadores], ['Chamados', stats?.totalChamados]].map(([label, value]) => <View key={label} style={styles.stat}><Text style={styles.statNumber}>{value ?? '-'}</Text><Text style={styles.muted}>{label}</Text></View>)}</View><Text style={styles.sectionTitle}>Categorias</Text>{categories.map((category) => <View key={category.id} style={styles.history}><Text style={styles.historyTitle}>{category.nome}</Text></View>)}<Text style={styles.sectionTitle}>Prestadores pendentes</Text>{users?.prestadores?.filter((provider) => !provider.aprovado).map((provider) => <View key={provider.id} style={styles.history}><Text style={styles.historyTitle}>{provider.nome}</Text><Text style={styles.body}>{provider.email}</Text><Button title="Aprovar prestador" onPress={async () => { await api.adminApproveProvider(provider.id); refresh(); }} /></View>)}<Text style={styles.sectionTitle}>Chamados recentes</Text>{calls.slice(0, 12).map((call) => <View key={call.id} style={styles.history}><Text style={styles.historyTitle}>{call.categoriaNome || 'Chamado'}</Text><Text style={styles.muted}>{call.status} · {call.clienteNome || 'cliente'}</Text>{['aberto', 'aceito', 'em_andamento'].includes(call.status) && <Button title="Cancelar por moderação" secondary onPress={async () => { await api.adminCancelCall(call.id); refresh(); }} />}</View>)}</Page>;
}

const styles = StyleSheet.create({ page: { padding: 24, paddingTop: 50, backgroundColor: palette.paper, minHeight: '100%' }, back: { color: palette.green, fontSize: 16, fontWeight: '800', marginBottom: 24 }, pageTitle: { color: palette.ink, fontSize: 30, fontWeight: '800', marginBottom: 18 }, body: { color: palette.muted, fontSize: 16, lineHeight: 24, marginBottom: 18 }, muted: { color: palette.muted, fontSize: 13 }, faq: { backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 12 }, faqQuestion: { color: palette.ink, fontSize: 16, fontWeight: '800', marginBottom: 8 }, field: { marginBottom: 15 }, label: { color: palette.ink, fontSize: 12, fontWeight: '800', marginBottom: 7, textTransform: 'uppercase', letterSpacing: .7 }, input: { backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, borderRadius: 9, padding: 14, color: palette.ink, fontSize: 16, minHeight: 50 }, button: { alignItems: 'center', backgroundColor: palette.green, borderRadius: 9, minHeight: 52, justifyContent: 'center', paddingHorizontal: 18, marginTop: 8, marginBottom: 10 }, buttonText: { color: palette.white, fontWeight: '800', fontSize: 15 }, buttonSecondary: { backgroundColor: palette.white, borderColor: palette.green, borderWidth: 1 }, buttonSecondaryText: { color: palette.green }, success: { backgroundColor: '#e4f5e7', padding: 16, borderRadius: 10 }, successText: { color: palette.green, fontWeight: '700' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }, chip: { borderColor: palette.line, borderWidth: 1, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12 }, chipActive: { backgroundColor: palette.green, borderColor: palette.green }, chipText: { color: palette.muted, fontWeight: '700' }, chipActiveText: { color: palette.white, fontWeight: '800' }, history: { backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, borderRadius: 10, padding: 15, marginBottom: 10 }, historyTitle: { color: palette.ink, fontSize: 16, fontWeight: '800', marginBottom: 5 }, sectionTitle: { color: palette.ink, fontSize: 19, fontWeight: '800', marginTop: 14, marginBottom: 12 }, statRow: { flexDirection: 'row', gap: 8, marginBottom: 16 }, stat: { backgroundColor: palette.green, borderRadius: 10, flex: 1, padding: 12 }, statNumber: { color: palette.lime, fontSize: 24, fontWeight: '900' }
});
