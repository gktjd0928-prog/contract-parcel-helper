package com.contractparcel.helper;

import android.os.Bundle;
import androidx.appcompat.app.AppCompatDelegate;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 휴대폰이 어두운 모드여도 앱은 항상 밝은(하얀) 화면으로 표시
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);
        // 앱 안에서 만든 기능: 제안서 그림을 문자·공유로 보내기
        registerPlugin(ProposalSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
