import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import MapView, { Marker } from 'react-native-maps';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { api } from './api';
import { AccountSettings, AdminScreen, ForgotPassword, HistoryScreen, PublicScreen, ResetPassword } from './screens';

const colors = { ink: '#17211b', muted: '#68756c', green: '#116149', lime: '#d8f36a', paper: '#f5f7f1', line: '#dce4da', white: '#fff', danger: '#b23a48' };
const statusLabels = { aberto: 'Procurando prestador', aceito: 'Prestador a caminho', em_andamento: 'Atendimento no local', concluido: 'Atendimento concluído', cancelado: 'Chamado cancelado' };

function Field({ label, ...props }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput placeholderTextColor="#96a098" style={styles.input} {...props} /></View>;
}

function Button({ title, onPress, secondary = false, disabled = false }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{title}</Text></Pressable>;
}

function Header({ user, onLogout, onNavigate }) {
  return <View style={styles.header}><View><Text style={styles.kicker}>SOS-CAR</Text><Text style={styles.greeting}>Olá, {user.nome?.split(' ')[0] || 'por aqui'}</Text></View><View style={styles.headerActions}>{onNavigate && <><Pressable onPress={() => onNavigate('history')}><Text style={styles.headerLink}>Histórico</Text></Pressable><Pressable onPress={() => onNavigate('settings')}><Text style={styles.headerLink}>Conta</Text></Pressable></>}<Pressable onPress={onLogout}><Text style={styles.logout}>Sair</Text></Pressable></View></View>;
}

async function currentLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Permita o acesso à localização para continuar.');
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

function Login({ onLogged, categories, onNavigate }) {
  const [mode, setMode] = useState('login');
  const [type, setType] = useState('cliente');
  const [form, setForm] = useState({ nome: '', email: '', senha: '', cpf: '', telefone: '', categoriaId: '' });
  const [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    setBusy(true);
    try {
      const response = mode === 'login' ? await api.login({ tipo: type, email: form.email, senha: form.senha }) : await api.registrar({ ...form, tipo: type, categoriaId: Number(form.categoriaId) });
      if (!response.token) { Alert.alert('Cadastro enviado', response.mensagem); setMode('login'); return; }
      await api.setToken(response.token);
      onLogged(type, response.usuario);
    } catch (error) { Alert.alert('Não foi possível continuar', error.message); }
    finally { setBusy(false); }
  };
  return <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>socorro na estrada, sem complicação.</Text>
    <Text style={styles.heroTitle}>Seu caminho de volta começa aqui.</Text>
    <Text style={styles.intro}>Peça ajuda para o seu veículo ou conecte-se a quem pode resolver.</Text>
    <View style={styles.segment}><Pressable onPress={() => setType('cliente')} style={[styles.segmentItem, type === 'cliente' && styles.segmentActive]}><Text style={type === 'cliente' ? styles.segmentTextActive : styles.segmentText}>Sou cliente</Text></Pressable><Pressable onPress={() => setType('prestador')} style={[styles.segmentItem, type === 'prestador' && styles.segmentActive]}><Text style={type === 'prestador' ? styles.segmentTextActive : styles.segmentText}>Sou prestador</Text></Pressable></View>
    <View style={styles.modeRow}><Pressable onPress={() => setMode('login')}><Text style={[styles.modeText, mode === 'login' && styles.modeSelected]}>Entrar</Text></Pressable><Pressable onPress={() => setMode('register')}><Text style={[styles.modeText, mode === 'register' && styles.modeSelected]}>Criar conta</Text></Pressable></View>
    {mode === 'register' && <Field label="Nome completo" value={form.nome} onChangeText={(value) => update('nome', value)} autoCapitalize="words" />}
    <Field label="E-mail" value={form.email} onChangeText={(value) => update('email', value)} keyboardType="email-address" autoCapitalize="none" />
    {mode === 'register' && <><Field label="CPF" value={form.cpf} onChangeText={(value) => update('cpf', value)} keyboardType="numeric" /><Field label="Telefone" value={form.telefone} onChangeText={(value) => update('telefone', value)} keyboardType="phone-pad" />{type === 'prestador' && <View style={styles.field}><Text style={styles.label}>Categoria</Text><View style={styles.categoryList}>{categories.map((category) => <Pressable key={category.id} onPress={() => update('categoriaId', String(category.id))} style={[styles.categoryChip, form.categoriaId === String(category.id) && styles.categoryChipActive]}><Text style={form.categoriaId === String(category.id) ? styles.chipTextActive : styles.chipText}>{category.nome}</Text></Pressable>)}</View></View>}</>}
    <Field label="Senha" value={form.senha} onChangeText={(value) => update('senha', value)} secureTextEntry />
    <Button title={busy ? 'Aguarde...' : mode === 'login' ? 'Entrar no SOS-CAR' : 'Criar conta'} onPress={submit} disabled={busy} />
    <Text style={styles.apiHint}>Servidor: {api.baseUrl}</Text><View style={styles.authLinks}><Pressable onPress={() => onNavigate('forgot')}><Text style={styles.link}>Esqueci minha senha</Text></Pressable><Pressable onPress={() => onNavigate('ajuda')}><Text style={styles.link}>Ajuda</Text></Pressable><Pressable onPress={() => onNavigate('sobre')}><Text style={styles.link}>Sobre</Text></Pressable><Pressable onPress={() => onNavigate('admin')}><Text style={styles.link}>Admin</Text></Pressable></View>
  </ScrollView>;
}

function ClientHome({ user, categories, onLogout, onNavigate }) {
  const [call, setCall] = useState(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ? String(categories[0].id) : '');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [rating, setRating] = useState('5');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { try { setCall(await api.chamadoAtual()); } catch (error) { Alert.alert('Atualização falhou', error.message); } };
  useEffect(() => { refresh(); const timer = setInterval(refresh, 7000); return () => clearInterval(timer); }, []);
  const openCall = async () => { setBusy(true); try { const position = await currentLocation(); setCall(await api.abrirChamado({ categoriaId: Number(categoryId), ...position, endereco: address, descricao })); } catch (error) { Alert.alert('Não foi possível abrir o chamado', error.message); } finally { setBusy(false); } };
  const cancel = async () => { try { setCall(await api.cancelarChamado(call.id)); } catch (error) { Alert.alert('Não foi possível cancelar', error.message); } };
  const evaluate = async () => { try { await api.avaliarChamado(call.id, { nota: Number(rating) }); setCall(null); Alert.alert('Obrigado', 'Sua avaliação foi registrada.'); } catch (error) { Alert.alert('Não foi possível avaliar', error.message); } };
  return <SafeAreaView style={styles.screen}><Header user={user} onLogout={onLogout} onNavigate={onNavigate} /><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.titleRow}><View><Text style={styles.eyebrow}>ÁREA DO CLIENTE</Text><Text style={styles.pageTitle}>{call ? 'Acompanhe seu socorro' : 'Precisa de ajuda?'}</Text></View><Text style={styles.pulse}>● AO VIVO</Text></View>
    {!call ? <View style={styles.panel}><Text style={styles.panelTitle}>Abra um chamado</Text><Text style={styles.panelDescription}>Encontre um profissional próximo para voltar à estrada.</Text><Text style={styles.label}>Tipo de atendimento</Text><View style={styles.categoryList}>{categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(String(category.id))} style={[styles.categoryChip, categoryId === String(category.id) && styles.categoryChipActive]}><Text style={categoryId === String(category.id) ? styles.chipTextActive : styles.chipText}>{category.nome}</Text></Pressable>)}</View><Field label="Onde você está? (opcional)" value={address} onChangeText={setAddress} placeholder="Rua, número, cidade" /><Field label="O que aconteceu? (opcional)" value={description} onChangeText={setDescription} placeholder="Ex.: pneu furou" multiline /><Button title={busy ? 'Obtendo localização...' : 'Pedir socorro agora'} onPress={openCall} disabled={busy} /></View> : <View style={styles.panel}><Text style={styles.status}>{statusLabels[call.status] || call.status}</Text><Text style={styles.panelTitle}>{call.categoriaNome || 'Atendimento'}</Text><Text style={styles.panelDescription}>{call.endereco || 'Localização enviada pelo GPS'}</Text>{typeof call.latitude === 'number' && <MapView style={styles.map} initialRegion={{ latitude: call.latitude, longitude: call.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}><Marker coordinate={{ latitude: call.latitude, longitude: call.longitude }} title="Local do chamado" /></MapView>}<View style={styles.progress}><View style={[styles.progressDot, styles.progressDone]} /><View style={[styles.progressLine, call.status !== 'aberto' && styles.progressDone]} /><View style={[styles.progressDot, call.status !== 'aberto' && styles.progressDone]} /><View style={[styles.progressLine, ['em_andamento', 'concluido'].includes(call.status) && styles.progressDone]} /><View style={[styles.progressDot, ['em_andamento', 'concluido'].includes(call.status) && styles.progressDone]} /></View><Text style={styles.stepLabels}>Pedido enviado       Aceito       No local</Text>{call.status === 'concluido' && <><Text style={styles.label}>Como foi o atendimento?</Text><View style={styles.rating}>{['1', '2', '3', '4', '5'].map((value) => <Pressable key={value} onPress={() => setRating(value)}><Text style={Number(rating) >= Number(value) ? styles.starActive : styles.star}>★</Text></Pressable>)}</View><Button title="Enviar avaliação" onPress={evaluate} /></>}{['aberto', 'aceito'].includes(call.status) && <Button title="Cancelar chamado" secondary onPress={cancel} />}</View>}
  </ScrollView></SafeAreaView>;
}

function ProviderHome({ user, onLogout, onNavigate }) {
  const [available, setAvailable] = useState(false); const [current, setCurrent] = useState(null); const [requests, setRequests] = useState([]); const [busy, setBusy] = useState(false);
  const refresh = async () => { try { setCurrent(await api.chamadoAtual()); setRequests(await api.disponiveis()); } catch (error) { Alert.alert('Atualização falhou', error.message); } };
  useEffect(() => { refresh(); const timer = setInterval(refresh, 7000); return () => clearInterval(timer); }, []);
  const toggle = async (value) => { try { setAvailable(value); await api.disponibilidade({ disponivel: value, ...(await currentLocation()) }); refresh(); } catch (error) { setAvailable(false); Alert.alert('Localização necessária', error.message); } };
  const action = async (name, id) => { setBusy(true); try { setCurrent(await api[name](id)); refresh(); } catch (error) { Alert.alert('Ação não concluída', error.message); } finally { setBusy(false); } };
  return <SafeAreaView style={styles.screen}><Header user={user} onLogout={onLogout} onNavigate={onNavigate} /><ScrollView contentContainerStyle={styles.content}><View style={styles.titleRow}><View><Text style={styles.eyebrow}>ÁREA DO PRESTADOR</Text><Text style={styles.pageTitle}>Pronto para atender?</Text></View><Switch value={available} onValueChange={toggle} trackColor={{ false: '#cbd5ce', true: colors.lime }} thumbColor={available ? colors.green : '#fff'} /></View><View style={styles.availability}><Text style={styles.availabilityTitle}>{available ? 'Você está disponível' : 'Você está offline'}</Text><Text style={styles.panelDescription}>{available ? 'Novos pedidos aparecem abaixo.' : 'Ative sua disponibilidade para receber chamados.'}</Text></View>{current && <View style={styles.panel}><Text style={styles.status}>{statusLabels[current.status]}</Text><Text style={styles.panelTitle}>{current.categoriaNome || 'Atendimento ativo'}</Text><Text style={styles.panelDescription}>{current.endereco || 'Localização do cliente enviada pelo GPS'}</Text>{typeof current.latitude === 'number' && <MapView style={styles.map} initialRegion={{ latitude: current.latitude, longitude: current.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}><Marker coordinate={{ latitude: current.latitude, longitude: current.longitude }} title="Local do atendimento" /></MapView>}{current.status === 'aceito' && <Button title="Cheguei ao local" onPress={() => action('iniciar', current.id)} disabled={busy} />}{current.status === 'em_andamento' && <Button title="Concluir atendimento" onPress={() => action('concluir', current.id)} disabled={busy} />}{current.status === 'aceito' && <Button title="Liberar chamado" secondary onPress={() => action('cancelarPrestador', current.id)} disabled={busy} />}</View>}<Text style={styles.sectionTitle}>Chamados próximos</Text>{requests.length === 0 ? <Text style={styles.empty}>Nenhum chamado disponível agora.</Text> : requests.map((request) => <View key={request.id} style={styles.request}><View style={styles.requestTop}><Text style={styles.requestTitle}>{request.categoriaNome}</Text><Text style={styles.distance}>{request.distanciaKm == null ? 'perto de você' : `${request.distanciaKm.toFixed(1)} km`}</Text></View><Text style={styles.panelDescription}>{request.endereco || 'Endereço não informado'}</Text><Text style={styles.requestDescription}>{request.descricao || 'Sem descrição adicional'}</Text><Button title="Aceitar chamado" onPress={() => action('aceitar', request.id)} disabled={!available || Boolean(current) || busy} /></View>)}</ScrollView></SafeAreaView>;
}

export default function App() {
  const [session, setSession] = useState(null); const [categories, setCategories] = useState([]); const [loading, setLoading] = useState(true); const [screen, setScreen] = useState('home'); const [resetLink, setResetLink] = useState(null);
  useEffect(() => { (async () => { try { const list = await api.categorias(); setCategories(list); const token = await api.getToken(); if (token) { const me = await api.me(); setSession(me); } } catch {} finally { setLoading(false); } })(); const handleUrl = (url) => { const parsed = Linking.parse(url); if (parsed.queryParams?.token && parsed.queryParams?.tipo) { setResetLink({ token: parsed.queryParams.token, type: parsed.queryParams.tipo }); setScreen('reset'); } }; Linking.getInitialURL().then((url) => url && handleUrl(url)); const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url)); return () => subscription.remove(); }, []);
  const logged = async (type, user) => setSession({ tipo: type, usuario: user });
  const logout = async () => { try { await api.logout(); } catch {} await api.setToken(null); setSession(null); };
  const navigate = (next) => setScreen(next);
  const saveUser = (user) => { setSession((current) => ({ ...current, usuario: user })); setScreen('home'); };
  if (loading) return <View style={styles.loading}><ActivityIndicator color={colors.green} size="large" /><Text style={styles.loadingText}>Carregando SOS-CAR</Text></View>;
  if (screen === 'forgot') return <><StatusBar style="dark" /><ForgotPassword onBack={() => navigate('home')} /></>;
  if (screen === 'reset' && resetLink) return <><StatusBar style="dark" /><ResetPassword token={resetLink.token} type={resetLink.type} onDone={() => { setResetLink(null); navigate('home'); }} /></>;
  if (screen === 'admin') return <><StatusBar style="dark" /><AdminScreen onBack={() => navigate('home')} onLogged={(admin) => { setSession(admin); }} onLogout={logout} /></>;
  if (['sobre', 'ajuda', 'termos', 'privacidade'].includes(screen)) return <><StatusBar style="dark" /><PublicScreen kind={screen} onBack={() => navigate('home')} /></>;
  if (screen === 'settings' && session) return <><StatusBar style="dark" /><AccountSettings user={session.usuario} categories={categories} onSaved={saveUser} onBack={() => navigate('home')} /></>;
  if (screen === 'history' && session) return <><StatusBar style="dark" /><HistoryScreen onBack={() => navigate('home')} /></>;
  return <><StatusBar style="dark" />{session ? session.tipo === 'cliente' ? <ClientHome user={session.usuario} categories={categories} onLogout={logout} onNavigate={navigate} /> : <ProviderHome user={session.usuario} onLogout={logout} onNavigate={navigate} /> : <SafeAreaView style={styles.auth}><Login onLogged={logged} categories={categories} onNavigate={navigate} /></SafeAreaView>}</>;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { marginTop: 12, color: colors.muted },
  auth: { flex: 1, backgroundColor: colors.paper },
  authContent: { padding: 26, paddingTop: 52, paddingBottom: 40 },
  brand: { color: colors.green, fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.5 },
  heroTitle: { color: colors.ink, fontSize: 34, lineHeight: 38, fontWeight: '800', marginTop: 14 },
  intro: { color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 12, marginBottom: 24 },
  segment: { flexDirection: 'row', backgroundColor: '#e8eee7', borderRadius: 12, padding: 4, marginBottom: 22 },
  segmentItem: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 9 }, segmentActive: { backgroundColor: colors.white }, segmentText: { color: colors.muted, fontWeight: '700' }, segmentTextActive: { color: colors.green, fontWeight: '800' },
  modeRow: { flexDirection: 'row', gap: 24, marginBottom: 18 }, modeText: { color: colors.muted, fontSize: 16, fontWeight: '700' }, modeSelected: { color: colors.green, textDecorationLine: 'underline' },
  field: { marginBottom: 15 }, label: { color: colors.ink, fontSize: 12, fontWeight: '800', marginBottom: 7, textTransform: 'uppercase', letterSpacing: .7 }, input: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 9, padding: 14, color: colors.ink, fontSize: 16, minHeight: 50, textAlignVertical: 'top' },
  button: { alignItems: 'center', backgroundColor: colors.green, borderRadius: 9, minHeight: 52, justifyContent: 'center', paddingHorizontal: 18, marginTop: 8 }, buttonText: { color: colors.white, fontWeight: '800', fontSize: 15 }, buttonSecondary: { backgroundColor: colors.white, borderColor: colors.green, borderWidth: 1 }, buttonSecondaryText: { color: colors.green }, disabled: { opacity: .5 }, apiHint: { color: '#9aa49c', fontSize: 11, marginTop: 20, textAlign: 'center' },
  screen: { flex: 1, backgroundColor: colors.paper }, header: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, headerActions: { flexDirection: 'row', gap: 16, alignItems: 'center' }, headerLink: { color: colors.green, fontWeight: '800' }, kicker: { color: colors.green, fontSize: 12, fontWeight: '900', letterSpacing: 2 }, greeting: { color: colors.ink, fontSize: 20, fontWeight: '800', marginTop: 3 }, logout: { color: colors.danger, fontWeight: '800' }, content: { padding: 22, paddingTop: 12, paddingBottom: 40 }, titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }, eyebrow: { color: colors.green, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 }, pageTitle: { color: colors.ink, fontSize: 29, fontWeight: '800', marginTop: 5, maxWidth: 270 }, pulse: { color: colors.green, fontSize: 10, fontWeight: '900', marginTop: 4 }, panel: { backgroundColor: colors.white, borderRadius: 12, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: colors.line }, panelTitle: { color: colors.ink, fontSize: 21, fontWeight: '800', marginBottom: 5 }, panelDescription: { color: colors.muted, fontSize: 14, lineHeight: 20 }, categoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }, categoryChip: { borderColor: colors.line, borderWidth: 1, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 12 }, categoryChipActive: { backgroundColor: colors.green, borderColor: colors.green }, chipText: { color: colors.muted, fontWeight: '700' }, chipTextActive: { color: colors.white, fontWeight: '800' }, status: { color: colors.green, fontWeight: '900', textTransform: 'uppercase', fontSize: 11, letterSpacing: 1, marginBottom: 10 }, progress: { alignItems: 'center', flexDirection: 'row', marginTop: 28 }, progressDot: { backgroundColor: '#d5ddd5', borderRadius: 8, height: 16, width: 16 }, progressLine: { backgroundColor: '#d5ddd5', flex: 1, height: 3 }, progressDone: { backgroundColor: colors.green }, stepLabels: { color: colors.muted, fontSize: 10, marginTop: 8, textAlign: 'center' }, rating: { flexDirection: 'row', gap: 4, marginBottom: 8 }, star: { color: '#d5ddd5', fontSize: 32 }, starActive: { color: '#e8b84d', fontSize: 32 }, map: { height: 190, borderRadius: 10, marginTop: 16, marginBottom: 8 }, authLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, marginTop: 18 }, link: { color: colors.green, fontWeight: '700', fontSize: 13 }, availability: { backgroundColor: colors.green, borderRadius: 12, padding: 18, marginBottom: 22 }, availabilityTitle: { color: colors.lime, fontWeight: '900', fontSize: 18, marginBottom: 4 }, sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', marginBottom: 12 }, empty: { color: colors.muted, paddingVertical: 20 }, request: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 }, requestTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }, requestTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' }, distance: { color: colors.green, fontWeight: '800', fontSize: 12 }, requestDescription: { color: colors.muted, fontSize: 13, marginTop: 8 }
});
