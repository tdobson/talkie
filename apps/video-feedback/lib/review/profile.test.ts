import { PROFILE_KEY, readProfile, saveProfile } from './profile';

beforeEach(() => localStorage.clear());

it('starts empty and remembers each part as it is saved', () => {
  expect(readProfile()).toEqual({ name: '', micChecked: false, practised: false });
  saveProfile({ name: 'Tim' });
  saveProfile({ micChecked: true });
  expect(readProfile()).toEqual({ name: 'Tim', micChecked: true, practised: false });
  saveProfile({ practised: true });
  expect(readProfile()).toEqual({ name: 'Tim', micChecked: true, practised: true });
});

it('treats anything malformed as nothing stored', () => {
  for (const bad of ['not json', 'null', '42', '{"name":7,"practised":"yes"}']) {
    localStorage.setItem(PROFILE_KEY, bad);
    expect(readProfile(), bad).toEqual({ name: '', micChecked: false, practised: false });
  }
});
